import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { execFile } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

export class RunManager {
  constructor({
    configDir = path.join(os.homedir(), '.devdesk'),
    historyFile = path.join(configDir, 'runs.json'),
    maxHistory = 100,
    maxLog = 20000,
    timeoutMs = 30 * 60 * 1000,
    spawnProcess = spawn,
    killTree = (pid) => execFileAsync('taskkill.exe', ['/PID', String(pid), '/T', '/F'], { timeout: 10000 }),
    powershellCommand = 'powershell.exe'
  } = {}) {
    this.configDir = configDir;
    this.historyFile = historyFile;
    this.maxHistory = maxHistory;
    this.maxLog = maxLog;
    this.timeoutMs = timeoutMs;
    this.spawnProcess = spawnProcess;
    this.killTree = killTree;
    this.powershellCommand = powershellCommand;
    this.runs = new Map();
    this.historyWrite = Promise.resolve();
  }

  publicRun(run) {
    return {
      id: run.id,
      project: run.project,
      taskId: run.taskId,
      provider: run.provider,
      status: run.status,
      startedAt: run.startedAt,
      finishedAt: run.finishedAt,
      exitCode: run.exitCode,
      log: run.log,
      signal: run.signal || null
    };
  }

  list(limit = 30) {
    return [...this.runs.values()]
      .map(run => this.publicRun(run))
      .sort((a, b) => String(b.startedAt).localeCompare(String(a.startedAt)))
      .slice(0, limit);
  }

  get(id) {
    const run = this.runs.get(id);
    return run ? this.publicRun(run) : null;
  }

  hasActiveRun() {
    return [...this.runs.values()].some(run => run.status === 'running');
  }

  async init() {
    try {
      const saved = JSON.parse(await fs.readFile(this.historyFile, 'utf8'));
      if (!Array.isArray(saved)) return;
      for (const record of saved.slice(0, this.maxHistory)) {
        if (!record || typeof record.id !== 'string' || typeof record.startedAt !== 'string') continue;
        const interrupted = record.status === 'running' || record.status === 'starting';
        this.runs.set(record.id, {
          ...record,
          status: interrupted ? 'interrupted' : record.status,
          finishedAt: interrupted ? new Date().toISOString() : record.finishedAt,
          log: String(record.log || '').slice(-this.maxLog) + (interrupted
            ? '\nDevDesk foi reiniciado durante esta execução; o processo não pode ser recuperado.'
            : ''),
          process: null,
          configPath: '',
          scriptPath: '',
          timeout: null,
          persistTimer: null,
          timedOut: false
        });
      }
      if ([...this.runs.values()].some(run => run.status === 'interrupted')) await this.persist();
    } catch {
      // Primeira execução ou histórico ainda inexistente/inválido.
    }
  }

  async persist() {
    const snapshot = [...this.runs.values()]
      .map(run => ({
        ...this.publicRun(run),
        log: String(run.log || '').slice(-this.maxLog)
      }))
      .sort((a, b) => String(b.startedAt).localeCompare(String(a.startedAt)))
      .slice(0, this.maxHistory);
    this.historyWrite = this.historyWrite.catch(() => {}).then(async () => {
      await fs.mkdir(this.configDir, { recursive: true });
      const temp = this.historyFile + '.tmp';
      await fs.writeFile(temp, JSON.stringify(snapshot, null, 2) + '\n', 'utf8');
      await fs.rename(temp, this.historyFile);
    });
    return this.historyWrite;
  }

  schedulePersist(run) {
    if (run.persistTimer) clearTimeout(run.persistTimer);
    run.persistTimer = setTimeout(() => {
      run.persistTimer = null;
      this.persist().catch(error => console.error('Falha ao salvar histórico do DevDesk:', error.message));
    }, 500);
  }

  appendLog(run, chunk) {
    run.log = (run.log + String(chunk)).slice(-this.maxLog);
    this.schedulePersist(run);
  }

  async start({ project, taskId, provider, command, args, cwd }) {
    // A reserva acontece antes do primeiro await para impedir duas inicializações simultâneas.
    if (this.hasActiveRun()) {
      const error = new Error('Já existe uma execução de IA em andamento. Aguarde ou cancele antes de iniciar outra.');
      error.code = 'RUN_ALREADY_ACTIVE';
      throw error;
    }

    const id = randomUUID();
    const tempBase = path.join(os.tmpdir(), 'devdesk-' + id);
    const run = {
      id, project, taskId, provider, status: 'running',
      startedAt: new Date().toISOString(), finishedAt: null,
      exitCode: null, log: '', process: null, signal: null,
      configPath: tempBase + '.json', scriptPath: tempBase + '.ps1',
      timeout: null, persistTimer: null, timedOut: false, finalized: false
    };
    this.runs.set(id, run);

    try {
      await fs.writeFile(run.configPath, JSON.stringify({ command, args }), 'utf8');
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
      await fs.writeFile(run.scriptPath, '\uFEFF' + psScript, 'utf8');
      await this.persist();

      const child = this.spawnProcess(
        this.powershellCommand,
        ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', run.scriptPath, run.configPath],
        { windowsHide: true, cwd, stdio: ['ignore', 'pipe', 'pipe'] }
      );
      run.process = child;
      child.stdout?.on('data', chunk => this.appendLog(run, chunk.toString()));
      child.stderr?.on('data', chunk => this.appendLog(run, chunk.toString()));

      run.timeout = setTimeout(() => {
        if (run.finalized || run.status !== 'running') return;
        run.timedOut = true;
        run.signal = 'timeout';
        this.appendLog(run, '\nExecução encerrada: tempo limite de 30 minutos excedido.');
        this.killTree(child.pid).catch(() => {
          try { child.kill(); } catch { /* processo já encerrado */ }
        });
      }, this.timeoutMs);

      child.on('error', error => {
        this.finalize(run, { error });
      });
      child.on('close', (code, signal) => {
        this.finalize(run, { code, signal });
      });

      return this.publicRun(run);
    } catch (error) {
      await Promise.all([
        fs.rm(run.configPath, { force: true }).catch(() => {}),
        fs.rm(run.scriptPath, { force: true }).catch(() => {})
      ]);
      run.status = 'failed';
      run.finishedAt = new Date().toISOString();
      run.log = (run.log + '\nFalha ao preparar a execução: ' + error.message).slice(-this.maxLog);
      run.process = null;
      await this.persist().catch(() => {});
      throw error;
    }
  }

  async finalize(run, { code = null, signal = null, error = null } = {}) {
    if (run.finalized) return;
    run.finalized = true;
    if (run.timeout) clearTimeout(run.timeout);
    if (run.status !== 'cancelled' && !run.timedOut) {
      run.status = error || code !== 0 ? 'failed' : 'succeeded';
    }
    run.exitCode = code;
    run.signal = run.signal || signal || null;
    run.finishedAt = new Date().toISOString();
    run.process = null;
    if (error) this.appendLog(run, '\nErro ao iniciar o agente CLI: ' + error.message);
    if (run.persistTimer) {
      clearTimeout(run.persistTimer);
      run.persistTimer = null;
    }
    await Promise.all([
      fs.rm(run.configPath, { force: true }).catch(() => {}),
      fs.rm(run.scriptPath, { force: true }).catch(() => {})
    ]);
    this.persist().catch(saveError => console.error('Falha ao salvar histórico do DevDesk:', saveError.message));
  }

  async cancel(id) {
    const run = this.runs.get(id);
    if (!run) return null;
    if (run.process && run.status === 'running') {
      run.status = 'cancelled';
      try {
        await this.killTree(run.process.pid);
      } catch {
        try { run.process.kill(); } catch { /* processo já encerrado */ }
      }
      this.persist().catch(error => console.error('Falha ao salvar histórico do DevDesk:', error.message));
    }
    return this.publicRun(run);
  }
}
