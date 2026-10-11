import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { RunManager } from '../src/execution/run-manager.js';

function fakeChild(pid = 1234) {
  const child = new EventEmitter();
  child.pid = pid;
  child.stdout = new EventEmitter();
  child.stderr = new EventEmitter();
  child.kill = () => queueMicrotask(() => child.emit('close', null, 'SIGTERM'));
  return child;
}

async function tempManager(options = {}) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'devdesk-test-'));
  const manager = new RunManager({
    configDir: dir,
    historyFile: path.join(dir, 'runs.json'),
    timeoutMs: 10000,
    spawnProcess: () => fakeChild(),
    killTree: async () => {},
    ...options
  });
  return { dir, manager };
}

test('reserva uma execução antes de qualquer await e bloqueia concorrência', async () => {
  const { dir, manager } = await tempManager();
  try {
    const firstPromise = manager.start({
      project: 'api', taskId: 'TASK-001', provider: 'fake',
      command: 'fake', args: [], cwd: dir
    });
    assert.equal(manager.hasActiveRun(), true);
    await assert.rejects(
      manager.start({ project: 'web', taskId: 'TASK-002', provider: 'fake', command: 'fake', args: [], cwd: dir }),
      error => error.code === 'RUN_ALREADY_ACTIVE'
    );
    const run = await firstPromise;
    manager.runs.get(run.id).process.emit('close', 0, null);
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(manager.get(run.id).status, 'succeeded');
    assert.equal(manager.hasActiveRun(), false);
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});

test('encerra a execução e registra timeout', async () => {
  let child;
  let killedPid;
  const { dir, manager } = await tempManager({
    timeoutMs: 15,
    spawnProcess: () => (child = fakeChild(9876)),
    killTree: async pid => {
      killedPid = pid;
      child.emit('close', 1, 'SIGTERM');
    }
  });
  try {
    const run = await manager.start({
      project: 'api', taskId: 'TASK-003', provider: 'fake',
      command: 'fake', args: [], cwd: dir
    });
    await new Promise(resolve => setTimeout(resolve, 60));
    assert.equal(killedPid, 9876);
    assert.equal(manager.get(run.id).status, 'failed');
    assert.equal(manager.get(run.id).signal, 'timeout');
    assert.match(manager.get(run.id).log, /tempo limite/i);
    assert.equal(manager.hasActiveRun(), false);
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});

test('cancelamento marca a execução como cancelada e encerra a árvore', async () => {
  let child;
  let killedPid;
  const { dir, manager } = await tempManager({
    spawnProcess: () => (child = fakeChild(4567)),
    killTree: async pid => {
      killedPid = pid;
      child.emit('close', null, 'SIGTERM');
    }
  });
  try {
    const run = await manager.start({
      project: 'api', taskId: 'TASK-004', provider: 'fake',
      command: 'fake', args: [], cwd: dir
    });
    const cancelled = await manager.cancel(run.id);
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(killedPid, 4567);
    assert.equal(cancelled.status, 'cancelled');
    assert.equal(manager.get(run.id).status, 'cancelled');
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});

test('restaura execuções em andamento como interrompidas sem reiniciá-las', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'devdesk-test-'));
  const historyFile = path.join(dir, 'runs.json');
  await fs.writeFile(historyFile, JSON.stringify([{
    id: 'run-old', project: 'api', taskId: 'TASK-005',
    provider: 'fake', status: 'running', startedAt: '2026-10-01T10:00:00.000Z', log: 'saida'
  }]));
  try {
    const manager = new RunManager({ configDir: dir, historyFile });
    await manager.init();
    assert.equal(manager.get('run-old').status, 'interrupted');
    assert.match(manager.get('run-old').log, /reiniciado/i);
    assert.equal(manager.hasActiveRun(), false);
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});
