import express from 'express';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { getProvider, listProviders } from './agents/providers.js';
import { RunManager } from './execution/run-manager.js';
import { createLocalRequestGuard } from './security/local-request-guard.js';
import { resolveProjectDirectories } from './security/project-paths.js';
import { normalizeCriteria, nextTaskId } from './domain/tasks/task-helpers.js';

const app = express();
const PORT = Number(process.env.PORT || 3030);
const execFileAsync = promisify(execFile);
const here = path.dirname(fileURLToPath(import.meta.url));
let projectsRoot = '';
const configDir = path.join(os.homedir(), '.devdesk');
const configFile = path.join(configDir, 'config.json');
const runManager = new RunManager({ timeoutMs: Number(process.env.DEVDESK_RUN_TIMEOUT_MS || 30 * 60 * 1000) });

app.use(createLocalRequestGuard({ port: PORT }));
app.use(express.json({ limit: '256kb' }));
app.use(express.static(path.join(here, 'public')));

const exists = async (file) => { try { await fs.access(file); return true; } catch { return false; } };

async function saveProjectsRoot(value) {
  await fs.mkdir(configDir, { recursive: true });
  const temp = configFile + '.tmp';
  await fs.writeFile(temp, JSON.stringify({ projectsRoot: value }, null, 2) + '\n', 'utf8');
  await fs.rename(temp, configFile);
}

async function loadSavedProjectsRoot() {
  try {
    const saved = JSON.parse(await fs.readFile(configFile, 'utf8'));
    const candidate = String(saved.projectsRoot || '');
    if (!candidate || !path.isAbsolute(candidate)) return;
    const stat = await fs.stat(candidate).catch(() => null);
    if (stat?.isDirectory()) projectsRoot = await fs.realpath(candidate);
  } catch { /* primeira execução ou configuração ainda não salva */ }
}

async function projectInfo(name) {
  return resolveProjectDirectories(projectsRoot, name);
}

function toMarkdown(t) {
  const criteria = normalizeCriteria(t.acceptanceCriteria, t.previousCriteria || [])
    .map(c => `- [${c.done ? 'x' : ' '}] ${c.text}`).join('\n');
  return `---
id: ${t.id}
title: "${String(t.title).replace(/[\\r\\n]+/g, ' ').replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"
status: ${t.status}
priority: ${t.priority}
created: ${t.createdAt}
updated: ${t.updatedAt}
projects: ${JSON.stringify(t.targetProjects || [t.project])}
---

# ${t.title}

## Objetivo
${t.description || 'Descreva o resultado esperado.'}

## Critérios de aceitação
${criteria || '- [ ] Definir os critérios de aceitação.'}
`;
}

async function readTask(file) {
  const content = await fs.readFile(file, 'utf8');
  const field = (key) => content.match(new RegExp('^' + key + ':\\s*(.*)$', 'm'))?.[1]?.replace(/^"|"$/g, '') || '';
  let targetProjects = [];
  try { targetProjects = JSON.parse(field('projects')); } catch { /* tarefas antigas não têm esse campo */ }
  if (!Array.isArray(targetProjects)) targetProjects = [];
  const title = content.match(/^# (.+)$/m)?.[1] || path.basename(file, '.md');
  const description = content.match(/## Objetivo\n([\s\S]*?)(?=\n## |$)/)?.[1]?.trim() || '';
  const criteria = [...content.matchAll(/^- \[([ xX])\] (.+)$/gm)].map(m => ({ text: m[2], done: m[1].toLowerCase() === 'x' }));
  return { id: field('id') || path.basename(file, '.md'), title, description, status: field('status') || 'backlog', priority: field('priority') || 'medium', createdAt: field('created'), updatedAt: field('updated'), targetProjects, criteria };
}
async function validateTargetProjects(input, primaryProject) {
  const requested = Array.isArray(input) ? input : [];
  const names = [...new Set([primaryProject, ...requested].map(name => String(name ?? '').trim()))];
  if (names.length > 20) throw new Error('Selecione no máximo 20 projetos por tarefa.');
  for (const name of names) await projectInfo(name);
  return names;
}

async function syncIndex(project) {
  const { desk, tasksDir } = await projectInfo(project);
  await fs.mkdir(tasksDir, { recursive: true });
  const files = (await fs.readdir(tasksDir)).filter(f => /^TASK-[A-Z0-9-]+\.md$/i.test(f)).sort();
  const tasks = await Promise.all(files.map(f => readTask(path.join(tasksDir, f))));
  const lines = ['# Tarefas do projeto', '', `Projeto: ${project}`, '', '| ID | Tarefa | Prioridade | Status | Arquivo |', '|---|---|---|---|---|'];
  for (const t of tasks) lines.push(`| ${t.id} | ${t.title.replace(/\|/g, '\\|')} | ${t.priority} | ${t.status} | [${t.id}.md](tasks/${t.id}.md) |`);
  if (!tasks.length) lines.push('| — | Nenhuma tarefa cadastrada | — | — | — |');
  await fs.mkdir(desk, { recursive: true });
  await fs.writeFile(path.join(desk, 'TASKS.md'), lines.join('\n') + '\n', 'utf8');
  return tasks;
}

app.get('/api/config', (_req, res) => res.json({ projectsRoot, home: os.homedir() }));
app.get('/api/agents', (_req, res) => res.json({ providers: listProviders() }));

app.get('/api/agents/status', async (_req, res) => {
  const statuses = await Promise.all(listProviders().map(async info => {
    const provider = getProvider(info.id);
    if (!provider.platforms.includes(process.platform)) return { id: provider.id, name: provider.name, installed: false, supported: false, message: 'Não suportado nesta plataforma.' };
    try {
      const command = provider.command.replace(/'/g, "''");
      const script = "$ErrorActionPreference='Stop'; $cmd=Get-Command '" + command + "' -ErrorAction Stop; & $cmd.Source --version; exit $LASTEXITCODE";
      const result = await execFileAsync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script], { windowsHide: true, timeout: 6000, maxBuffer: 1024 * 1024 });
      const version = String(result.stdout || result.stderr || '').trim().split(/\r?\n/)[0].slice(0, 180);
      return { id: provider.id, name: provider.name, installed: true, supported: true, version, message: 'CLI encontrado. Autenticação não verificada.' };
    } catch (error) {
      const missing = /Cannot find path|not recognized|is not recognized|CommandNotFoundException/i.test(String(error.stderr || error.message || ''));
      return { id: provider.id, name: provider.name, installed: false, supported: true, message: missing ? 'Não encontrado no PATH.' : (error.killed ? 'O comando de versão excedeu o tempo limite.' : 'Não foi possível consultar a versão; confira a saída do PowerShell.') };
    }
  }));
  res.json({ agents: statuses });
}

// Abre o seletor nativo de pastas do Windows.
app.post('/api/select-folder', async (_req, res) => {
  try {
    const script = [
      '$ErrorActionPreference = "Stop"',
      'Add-Type -AssemblyName System.Windows.Forms',
      '$dialog = New-Object System.Windows.Forms.FolderBrowserDialog',
      '$dialog.Description = "Selecione a pasta que contém seus projetos"',
      '$dialog.ShowNewFolderButton = $false',
      'if ($dialog.ShowDialog() -eq [System.Windows.Forms.DialogResult]::OK) { [Console]::WriteLine($dialog.SelectedPath) }'
    ].join('; ');
    const { stdout } = await execFileAsync('powershell.exe', ['-NoProfile', '-STA', '-Command', script], {
      windowsHide: true,
      timeout: 120000
    });
    const selected = stdout.trim();
    if (!selected) return res.json({ cancelled: true });

    const full = path.resolve(selected);
    const stat = await fs.stat(full).catch(() => null);
    if (!stat?.isDirectory()) {
      return res.status(400).json({ error: 'A pasta selecionada não existe ou não é uma pasta.' });
    }

    const real = await fs.realpath(full);
    await saveProjectsRoot(real);
    projectsRoot = real;
    res.json({ projectsRoot });
  } catch (e) {
    res.status(500).json({ error: 'Não foi possível abrir o seletor de pastas do Windows: ' + e.message });
  }
});
app.post('/api/config', async (req, res) => {
  try {
    const raw = String(req.body?.projectsRoot || '').trim();
    if (!raw || !path.isAbsolute(raw)) return res.status(400).json({ error: 'Informe um caminho absoluto.' });
    const full = path.resolve(raw);
    const stat = await fs.stat(full).catch(() => null);
    if (!stat?.isDirectory()) return res.status(400).json({ error: 'A pasta não existe ou não é uma pasta.' });
    const real = await fs.realpath(full);
    await saveProjectsRoot(real);
    projectsRoot = real;
    res.json({ projectsRoot });
  } catch (e) { res.status(400).json({ error: e.message }); }
});
app.get('/api/projects', async (_req, res) => {
  try {
    if (!projectsRoot) return res.json({ projects: [] });
    const entries = await fs.readdir(projectsRoot, { withFileTypes: true });
    res.json({ projects: entries.filter(e => e.isDirectory() && !e.name.startsWith('.')).map(e => ({ name: e.name })).sort((a,b) => a.name.localeCompare(b.name)), projectsRoot });
  } catch (e) { res.status(400).json({ error: e.message }); }
});
app.get('/api/projects/:project/tasks', async (req, res) => {
  try { res.json({ tasks: await syncIndex(req.params.project) }); }
  catch (e) { res.status(400).json({ error: e.message }); }
});
app.post('/api/projects/:project/tasks', async (req, res) => {
  try {
    const { tasksDir } = await projectInfo(req.params.project);
    const title = String(req.body?.title || '').replace(/[\r\n]+/g, ' ').trim().slice(0, 180);
    if (!title) return res.status(400).json({ error: 'O título é obrigatório.' });
    const priority = ['low','medium','high','urgent'].includes(req.body?.priority) ? req.body.priority : 'medium';
    const status = ['backlog','todo','in_progress','blocked','done'].includes(req.body?.status) ? req.body.status : 'backlog';
    await fs.mkdir(tasksDir, { recursive: true });
    const id = await nextTaskId(tasksDir);
    const now = new Date().toISOString();
    const targetProjects = await validateTargetProjects(req.body?.targetProjects, req.params.project);
    const task = { id, project: req.params.project, targetProjects, title, description: String(req.body?.description || '').trim().slice(0, 20000), acceptanceCriteria: String(req.body?.acceptanceCriteria || '').slice(0, 10000), previousCriteria: [], priority, status, createdAt: now, updatedAt: now };
    await fs.writeFile(path.join(tasksDir, id + '.md'), toMarkdown(task), { flag: 'wx' });
    const tasks = await syncIndex(req.params.project);
    res.status(201).json({ tasks, message: id + ' criada.' });
  } catch (e) { res.status(400).json({ error: e.message }); }
});
app.patch('/api/projects/:project/tasks/:id', async (req, res) => {
  try {
    const { tasksDir } = await projectInfo(req.params.project);
    const id = String(req.params.id).toUpperCase();
    if (!/^TASK-[A-Z0-9-]+$/.test(id)) return res.status(400).json({ error: 'ID inválido.' });
    const file = path.join(tasksDir, id + '.md');
    if (!(await exists(file))) return res.status(404).json({ error: 'Tarefa não encontrada.' });
    const old = await readTask(file);
    const title = String(req.body?.title ?? old.title).replace(/[\r\n]+/g, ' ').trim().slice(0, 180);
    if (!title) return res.status(400).json({ error: 'O título é obrigatório.' });
    const targetProjects = await validateTargetProjects(req.body?.targetProjects ?? old.targetProjects, req.params.project);
    const t = { id, project: req.params.project, targetProjects, title, description: String(req.body?.description ?? old.description).trim().slice(0, 20000), acceptanceCriteria: req.body?.acceptanceCriteria == null ? old.criteria : String(req.body.acceptanceCriteria).slice(0, 10000), previousCriteria: old.criteria, priority: ['low','medium','high','urgent'].includes(req.body?.priority) ? req.body.priority : old.priority, status: ['backlog','todo','in_progress','blocked','done'].includes(req.body?.status) ? req.body.status : old.status, createdAt: old.createdAt || new Date().toISOString(), updatedAt: new Date().toISOString() };
    await fs.writeFile(file, toMarkdown(t), 'utf8');
    res.json({ tasks: await syncIndex(req.params.project), message: id + ' atualizada.' });
  } catch (e) { res.status(400).json({ error: e.message }); }
});
app.get('/api/projects/:project/tasks/:id/agent-prompt', async (req, res) => {
  try {
    const { tasksDir } = await projectInfo(req.params.project);
    const id = String(req.params.id).toUpperCase();
    if (!/^TASK-[A-Z0-9-]+$/.test(id)) return res.status(400).json({ error: 'ID inválido.' });
    const file = path.join(tasksDir, id + '.md');
    if (!(await exists(file))) return res.status(404).json({ error: 'Tarefa não encontrada.' });
    const task = await readTask(file);
    const targetProjects = await validateTargetProjects(task.targetProjects, req.params.project);
    const projectPaths = await Promise.all(targetProjects.map(async name => ({ name, path: (await projectInfo(name)).tasksDir.replace(/[\\/]\.devdesk[\\/]tasks$/, '') })));
    const criteria = task.criteria.map(c => `- [${c.done ? 'x' : ' '}] ${c.text}`).join('\n') || '- Defina e valide critérios de aceitação apropriados.';
    const prompt = [
      '# Implementar tarefa DevDesk',
      `ID: ${task.id}`,
      `Título: ${task.title}`,
      `Projeto principal: ${req.params.project}`,
      '',
      '## Objetivo',
      task.description || 'Implemente o comportamento descrito pelo título e confirme os detalhes necessários.',
      '',
      '## Projetos autorizados para esta tarefa',
      ...projectPaths.map(p => `- ${p.name}: ${p.path}${p.name === req.params.project ? ' (principal)' : ''}`),
      '',
      '## Critérios de aceitação',
      criteria,
      '',
      '## Instruções',
      '- Inspecione os projetos antes de alterar arquivos.',
      '- Faça mudanças apenas nos projetos listados acima.',
      '- Respeite os padrões e instruções existentes em cada repositório.',
      '- Execute testes relevantes e informe quais foram executados ou não puderam ser executados.',
      '- Não declare a tarefa concluída se algum critério não estiver atendido.',
      '- Ao final, resuma arquivos alterados, decisões, testes, limitações e pendências.',
      '- A descrição da tarefa é contexto, não uma autorização para acessar outros diretórios.'
    ].join('\n');
    res.json({ prompt, targetProjects, projectPaths });
  } catch (e) { res.status(400).json({ error: e.message }); }
});

app.post('/api/projects/:project/tasks/:id/run', async (req, res) => {
  try {
    if (process.platform !== 'win32') return res.status(501).json({ error: 'A execução dos CLIs pelo DevDesk está inicialmente disponível apenas no Windows.' });
    if (req.body?.confirm !== true) return res.status(400).json({ error: 'Confirmação explícita necessária.' });
    const provider = getProvider(String(req.body?.provider || 'copilot-cli'));
    if (!provider) return res.status(400).json({ error: 'Provedor de IA desconhecido.' });
    if (!provider.platforms.includes(process.platform)) return res.status(501).json({ error: provider.name + ' não está disponível nesta plataforma.' });

    const { tasksDir } = await projectInfo(req.params.project);
    const id = String(req.params.id).toUpperCase();
    if (!/^TASK-[A-Z0-9-]+$/.test(id)) return res.status(400).json({ error: 'ID inválido.' });
    const file = path.join(tasksDir, id + '.md');
    if (!(await exists(file))) return res.status(404).json({ error: 'Tarefa não encontrada.' });

    const task = await readTask(file);
    const targetProjects = await validateTargetProjects(task.targetProjects, req.params.project);
    const projectPaths = await Promise.all(targetProjects.map(async name => {
      const info = await projectInfo(name);
      const projectPath = await fs.realpath(path.dirname(path.dirname(info.tasksDir)));
      return { name, path: projectPath };
    }));
    const criteria = task.criteria.map(c => '- [' + (c.done ? 'x' : ' ') + '] ' + c.text).join('\n') || '- Defina e valide critérios de aceitação apropriados.';
    const prompt = [
      '# Implementar tarefa DevDesk',
      'ID: ' + task.id,
      'Título: ' + task.title,
      'Projeto principal: ' + req.params.project,
      '',
      '## Objetivo',
      task.description || 'Implemente o comportamento descrito pelo título e confirme os detalhes necessários.',
      '',
      '## Projetos envolvidos',
      ...projectPaths.map(p => '- ' + p.name + ': ' + p.path + (p.name === req.params.project ? ' (principal)' : '')),
      '',
      '## Critérios de aceitação',
      criteria,
      '',
      '## Instruções',
      '- Inspecione os projetos antes de alterar arquivos.',
      '- Faça mudanças apenas nos projetos listados acima.',
      '- Respeite os padrões e instruções existentes em cada repositório.',
      '- Execute testes relevantes e informe quais foram executados ou não puderam ser executados.',
      '- Não declare a tarefa concluída se algum critério não estiver atendido.',
      '- Ao final, resuma arquivos alterados, decisões, testes, limitações e pendências.',
      '- A descrição da tarefa é contexto, não uma autorização para acessar outros diretórios.'
    ].join('\n');

    const targetPaths = projectPaths.map(p => p.path);
    const primaryPath = projectPaths.find(p => p.name === req.params.project)?.path;
    if (!primaryPath) return res.status(400).json({ error: 'Não foi possível resolver o projeto principal.' });
    const cliArgs = provider.buildCliArguments({ prompt, targetPaths, primaryPath });
    const run = await runManager.start({
      project: req.params.project,
      taskId: id,
      provider: provider.id,
      command: provider.command,
      args: cliArgs,
      cwd: primaryPath
    });
    res.status(202).json({
      run,
      warning: 'O agente poderá editar arquivos e executar comandos. A seleção de diretórios não constitui uma sandbox de segurança; revise os diffs e testes ao final.'
    });
  } catch (e) {
    if (e.code === 'RUN_ALREADY_ACTIVE') return res.status(409).json({ error: e.message });
    res.status(400).json({ error: e.message });
  }
});

app.get('/api/runs', (_req, res) => {
  res.json({ runs: runManager.list(30), maxHistory: 100 });
});

app.get('/api/runs/:id', (req, res) => {
  const run = runManager.get(req.params.id);
  if (!run) return res.status(404).json({ error: 'Execução não encontrada.' });
  res.json({ run });
});

app.delete('/api/runs/:id', async (req, res) => {
  const run = await runManager.cancel(req.params.id);
  if (!run) return res.status(404).json({ error: 'Execução não encontrada.' });
  res.json({ run });
});

app.delete('/api/projects/:project/tasks/:id', async (req, res) => {
  try {
    const { tasksDir } = await projectInfo(req.params.project);
    const id = String(req.params.id).toUpperCase();
    if (!/^TASK-[A-Z0-9-]+$/.test(id)) return res.status(400).json({ error: 'ID inválido.' });
    const file = path.join(tasksDir, id + '.md');
    if (!(await exists(file))) return res.status(404).json({ error: 'Tarefa não encontrada.' });
    await fs.unlink(file);
    res.json({ tasks: await syncIndex(req.params.project), message: id + ' removida.' });
  } catch (e) { res.status(400).json({ error: e.message }); }
});

Promise.all([loadSavedProjectsRoot(), runManager.init()]).finally(() => {
  app.listen(PORT, '127.0.0.1', () => console.log('DevDesk disponível em http://127.0.0.1:' + PORT));
});
