import express from 'express';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { execFile, spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { getProvider, listProviders } from './agents/providers.js';

const app = express();
const PORT = Number(process.env.PORT || 3030);
const execFileAsync = promisify(execFile);
const here = path.dirname(fileURLToPath(import.meta.url));
let projectsRoot = '';
const configDir = path.join(os.homedir(), '.devdesk');
const configFile = path.join(configDir, 'config.json');
const runHistoryFile = path.join(configDir, 'runs.json');
const MAX_RUN_HISTORY = 100;
const MAX_PERSISTED_LOG = 20000;
const agentRuns = new Map();
let historyWrite = Promise.resolve();

app.use(express.json({ limit: '256kb' }));
app.use(express.static(path.join(here, 'public')));

const safeName = (value) => String(value ?? '').trim().replace(/[<>:"/\\|?*\x00-\x1F]/g, '-').replace(/[. ]+$/g, '').slice(0, 100);
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

function runRecord(run) {
  return { id: run.id, project: run.project, taskId: run.taskId, provider: run.provider, status: run.status, startedAt: run.startedAt, finishedAt: run.finishedAt, exitCode: run.exitCode, log: String(run.log || '').slice(-MAX_PERSISTED_LOG), signal: run.signal || null };
}

function persistRunHistory() {
  const snapshot = [...agentRuns.values()].map(runRecord).sort((a, b) => String(b.startedAt).localeCompare(String(a.startedAt))).slice(0, MAX_RUN_HISTORY);
  historyWrite = historyWrite.catch(() => {}).then(async () => {
    await fs.mkdir(configDir, { recursive: true });
    const temp = runHistoryFile + '.tmp';
    await fs.writeFile(temp, JSON.stringify(snapshot, null, 2) + '\n', 'utf8');
    await fs.rename(temp, runHistoryFile);
  });
  return historyWrite;
}

async function loadRunHistory() {
  try {
    const saved = JSON.parse(await fs.readFile(runHistoryFile, 'utf8'));
    if (!Array.isArray(saved)) return;
    for (const record of saved.slice(0, MAX_RUN_HISTORY)) {
      if (!record || typeof record.id !== 'string' || typeof record.startedAt !== 'string') continue;
      const interrupted = record.status === 'running';
      agentRuns.set(record.id, { ...record, status: interrupted ? 'interrupted' : record.status, finishedAt: interrupted ? new Date().toISOString() : record.finishedAt, log: String(record.log || '').slice(-MAX_PERSISTED_LOG) + (interrupted ? '\nDevDesk foi reiniciado durante esta execução; o estado do processo não pode ser recuperado.' : ''), process: null, configPath: '', scriptPath: '' });
    }
    if ([...agentRuns.values()].some(run => run.status === 'interrupted')) await persistRunHistory();
  } catch { /* primeira execução ou histórico ainda inexistente */ }
}

function scheduleRunHistorySave(run) {
  if (run.persistTimer) clearTimeout(run.persistTimer);
  run.persistTimer = setTimeout(() => { run.persistTimer = null; persistRunHistory().catch(error => console.error('Falha ao salvar histórico do DevDesk:', error.message)); }, 500);
}
async function projectInfo(name) {
  if (!projectsRoot) throw new Error('Configure a pasta raiz primeiro.');
  const clean = safeName(name);
  if (!clean || clean !== name) throw new Error('Nome de projeto inválido.');
  const folder = path.resolve(projectsRoot, clean);
  if (path.dirname(folder) !== projectsRoot) throw new Error('Projeto fora da raiz permitida.');
  const stat = await fs.stat(folder).catch(() => null);
  if (!stat?.isDirectory()) throw new Error('A pasta do projeto não existe.');
  const [realRoot, realFolder] = await Promise.all([fs.realpath(projectsRoot), fs.realpath(folder)]);
  if (path.dirname(realFolder) !== realRoot) throw new Error('O projeto precisa ser uma pasta direta da raiz.');
  const desk = path.join(realFolder, '.devdesk');
  return { desk, tasksDir: path.join(desk, 'tasks') };
}

function toMarkdown(t) {
  const criteria = String(t.acceptanceCriteria || '').split(/\r?\n/).map(s => s.trim()).filter(Boolean)
    .map(s => `- [ ] ${s.replace(/^[-*]\s*/, '').replace(/^\[[ xX]\]\s*/, '')}`).join('\n');
  return `---
id: ${t.id}
title: "${t.title.replace(/"/g, '\\"')}"
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
      const result = await execFileAsync(provider.command, ['--version'], { windowsHide: true, timeout: 6000, maxBuffer: 1024 * 1024 });
      const version = String(result.stdout || result.stderr || '').trim().split(/\r?\n/)[0].slice(0, 180);
      return { id: provider.id, name: provider.name, installed: true, supported: true, version, message: 'CLI encontrado. Autenticação não verificada.' };
    } catch (error) {
      const missing = error.code === 'ENOENT';
      return { id: provider.id, name: provider.name, installed: false, supported: true, message: missing ? 'Não encontrado no PATH.' : (error.killed ? 'O comando de versão excedeu o tempo limite.' : 'Não foi possível consultar a versão.') };
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
    const title = String(req.body?.title || '').trim().slice(0, 180);
    if (!title) return res.status(400).json({ error: 'O título é obrigatório.' });
    const priority = ['low','medium','high','urgent'].includes(req.body?.priority) ? req.body.priority : 'medium';
    const status = ['backlog','todo','in_progress','blocked','done'].includes(req.body?.status) ? req.body.status : 'backlog';
    await fs.mkdir(tasksDir, { recursive: true });
    const files = (await fs.readdir(tasksDir)).filter(f => /^TASK-\d+\.md$/i.test(f));
    const n = files.reduce((max, f) => Math.max(max, Number(f.match(/TASK-(\d+)/i)?.[1] || 0)), 0) + 1;
    const id = `TASK-${String(n).padStart(3, '0')}`;
    const now = new Date().toISOString();
    const targetProjects = await validateTargetProjects(req.body?.targetProjects, req.params.project);
    const task = { id, project: req.params.project, targetProjects, title, description: String(req.body?.description || '').trim().slice(0, 20000), acceptanceCriteria: String(req.body?.acceptanceCriteria || '').slice(0, 10000), priority, status, createdAt: now, updatedAt: now };
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
    const title = String(req.body?.title ?? old.title).trim().slice(0, 180);
    if (!title) return res.status(400).json({ error: 'O título é obrigatório.' });
    const targetProjects = await validateTargetProjects(req.body?.targetProjects ?? old.targetProjects, req.params.project);
    const t = { id, project: req.params.project, targetProjects, title, description: String(req.body?.description ?? old.description).trim().slice(0, 20000), acceptanceCriteria: String(req.body?.acceptanceCriteria ?? old.criteria.map(c => c.text).join('\n')).slice(0, 10000), priority: ['low','medium','high','urgent'].includes(req.body?.priority) ? req.body.priority : old.priority, status: ['backlog','todo','in_progress','blocked','done'].includes(req.body?.status) ? req.body.status : old.status, createdAt: old.createdAt || new Date().toISOString(), updatedAt: new Date().toISOString() };
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
  let configPath = '';
  let scriptPath = '';
  try {
    if (process.platform !== 'win32') return res.status(501).json({ error: 'A execução do Copilot CLI pelo DevDesk está inicialmente disponível apenas no Windows.' });
    if (req.body?.confirm !== true) return res.status(400).json({ error: 'Confirmação explícita necessária.' });
    if ([...agentRuns.values()].some(existing => existing.status === 'running')) return res.status(409).json({ error: 'Já existe uma execução de IA em andamento. Aguarde ou cancele antes de iniciar outra.' });
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
      return { name, path: info.tasksDir.replace(/[\\/]\.devdesk[\\/]tasks$/, '') };
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
    const runId = randomUUID();
    const tempBase = path.join(os.tmpdir(), 'devdesk-' + runId);
    configPath = tempBase + '.json';
    scriptPath = tempBase + '.ps1';
    const targetPaths = projectPaths.map(p => p.path);
    const primaryPath = projectPaths.find(p => p.name === req.params.project).path;
    const cliArgs = provider.buildCliArguments({ prompt, targetPaths, primaryPath });
    await fs.writeFile(configPath, JSON.stringify({ command: provider.command, args: cliArgs }), 'utf8');
    const psScript = [
      'param([string]$ConfigPath)',
      '$ErrorActionPreference = "Stop"',
      '$config = Get-Content -LiteralPath $ConfigPath -Raw | ConvertFrom-Json',
      '$command = [string]$config.command',
      'if (-not (Get-Command $command -ErrorAction SilentlyContinue)) { [Console]::Error.WriteLine("CLI não encontrado: " + $command + ". Instale e autentique o agente selecionado."); exit 127 }',
      '$cliArgs = @($config.args | ForEach-Object { [string]$_ })',
      '& $command @cliArgs',
      'exit $LASTEXITCODE'
    ].join('\r\n');
    await fs.writeFile(scriptPath, '\uFEFF' + psScript, 'utf8');
    const run = { id: runId, project: req.params.project, taskId: id, provider: provider.id, status: 'running', startedAt: new Date().toISOString(), finishedAt: null, exitCode: null, log: '', process: null, configPath, scriptPath };
    agentRuns.set(runId, run);
    const child = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', scriptPath, configPath], { windowsHide: true, cwd: projectPaths.find(p => p.name === req.params.project).path, stdio: ['ignore', 'pipe', 'pipe'] });
    run.process = child;
    const appendLog = chunk => { run.log = (run.log + chunk.toString()).slice(-MAX_PERSISTED_LOG); scheduleRunHistorySave(run); };
    child.stdout.on('data', appendLog);
    child.stderr.on('data', appendLog);
    child.on('error', err => { run.status = 'failed'; run.log += '\nErro ao iniciar o agente CLI: ' + err.message; run.finishedAt = new Date().toISOString(); persistRunHistory().catch(error => console.error('Falha ao salvar histórico do DevDesk:', error.message)); });
    child.on('close', async (code, signal) => {
      if (run.status !== 'cancelled') run.status = code === 0 ? 'succeeded' : 'failed';
      run.exitCode = code;
      run.signal = signal;
      run.finishedAt = new Date().toISOString();
      run.process = null;
      await Promise.all([fs.rm(configPath, { force: true }), fs.rm(scriptPath, { force: true })]);
      if (run.persistTimer) { clearTimeout(run.persistTimer); run.persistTimer = null; }
      persistRunHistory().catch(error => console.error('Falha ao salvar histórico do DevDesk:', error.message));
    });
    res.status(202).json({ run: publicRun(run), warning: 'O Copilot recebeu permissão para editar arquivos e executar comandos. O DevDesk limita os diretórios declarados, mas isso não é uma sandbox de segurança.' });
  } catch (e) {
    await Promise.all([configPath && fs.rm(configPath, { force: true }).catch(() => {}), scriptPath && fs.rm(scriptPath, { force: true }).catch(() => {})]);
    res.status(400).json({ error: e.message });
  }
});

function publicRun(run) {
  return { id: run.id, project: run.project, taskId: run.taskId, provider: run.provider, status: run.status, startedAt: run.startedAt, finishedAt: run.finishedAt, exitCode: run.exitCode, log: run.log, signal: run.signal };
}

app.get('/api/runs', (_req, res) => {
  const runs = [...agentRuns.values()].map(publicRun).sort((a, b) => String(b.startedAt).localeCompare(String(a.startedAt))).slice(0, 30);
  res.json({ runs, maxHistory: MAX_RUN_HISTORY });
});

app.get('/api/runs/:id', (req, res) => {
  const run = agentRuns.get(req.params.id);
  if (!run) return res.status(404).json({ error: 'Execução não encontrada.' });
  res.json({ run: publicRun(run) });
});

app.delete('/api/runs/:id', async (req, res) => {
  const run = agentRuns.get(req.params.id);
  if (!run) return res.status(404).json({ error: 'Execução não encontrada.' });
  if (run.process && run.status === 'running') {
    run.status = 'cancelled';
    try { await execFileAsync('taskkill.exe', ['/PID', String(run.process.pid), '/T', '/F'], { timeout: 10000 }); }
    catch { run.process.kill(); }
  }
  res.json({ run: publicRun(run) });
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

Promise.all([loadSavedProjectsRoot(), loadRunHistory()]).finally(() => {
  app.listen(PORT, '127.0.0.1', () => console.log('DevDesk disponível em http://127.0.0.1:' + PORT));
});
