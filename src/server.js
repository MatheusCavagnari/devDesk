import express from 'express';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { getProvider, listProviders } from './agents/providers.js';
import { buildProviderArguments } from './agents/provider-contract.js';
import { RunManager } from './execution/run-manager.js';
import { createLocalRequestGuard } from './security/local-request-guard.js';
import { MarkdownTaskRepository } from './repositories/markdown-task-repository.js';
import { createTaskRouter } from './api/routes/tasks.routes.js';

const app = express();
const PORT = Number(process.env.PORT || 3030);
const execFileAsync = promisify(execFile);
const here = path.dirname(fileURLToPath(import.meta.url));
let projectsRoot = '';
const configDir = path.join(os.homedir(), '.devdesk');
const configFile = path.join(configDir, 'config.json');
const runManager = new RunManager({ timeoutMs: Number(process.env.DEVDESK_RUN_TIMEOUT_MS || 30 * 60 * 1000) });
const taskRepository = new MarkdownTaskRepository({ getProjectsRoot: () => projectsRoot });

app.use(createLocalRequestGuard({ port: PORT }));
app.use(express.json({ limit: '256kb' }));
app.use(express.static(path.join(here, 'public')));
app.use(createTaskRouter({ taskRepository }));

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
app.post('/api/projects/:project/tasks/:id/run', async (req, res) => {
  try {
    if (process.platform !== 'win32') return res.status(501).json({ error: 'A execução dos CLIs pelo DevDesk está inicialmente disponível apenas no Windows.' });
    if (req.body?.confirm !== true) return res.status(400).json({ error: 'Confirmação explícita necessária.' });
    const provider = getProvider(String(req.body?.provider || 'copilot-cli'));
    if (!provider) return res.status(400).json({ error: 'Provedor de IA desconhecido.' });
    if (!provider.platforms.includes(process.platform)) return res.status(501).json({ error: provider.name + ' não está disponível nesta plataforma.' });

    const id = String(req.params.id).toUpperCase();
    const { task } = await taskRepository.getTask(req.params.project, id);
    const { projectPaths } = await taskRepository.buildAgentPrompt(req.params.project, id);
    const targetPaths = projectPaths.map(p => p.path);
    const primaryPath = projectPaths.find(p => p.name === req.params.project)?.path;
    if (!primaryPath) return res.status(400).json({ error: 'Não foi possível resolver o projeto principal.' });
    const cliArgs = buildProviderArguments(provider, { prompt, targetPaths, primaryPath });
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

Promise.all([loadSavedProjectsRoot(), runManager.init()]).finally(() => {
  app.listen(PORT, '127.0.0.1', () => console.log('DevDesk disponível em http://127.0.0.1:' + PORT));
});
