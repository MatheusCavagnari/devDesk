import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { normalizeCriteria, nextTaskId } from '../src/domain/tasks/task-helpers.js';
import { resolveProjectDirectories, validateProjectName } from '../src/security/project-paths.js';
import { createLocalRequestGuard } from '../src/security/local-request-guard.js';

test('preserva o estado marcado de critérios ao editar o texto', () => {
  const previous = [{ text: 'Teste A', done: true }, { text: 'Teste B', done: false }];
  assert.deepEqual(normalizeCriteria('Teste A\nTeste B\nTeste C', previous), [
    { text: 'Teste A', done: true },
    { text: 'Teste B', done: false },
    { text: 'Teste C', done: false }
  ]);
  assert.deepEqual(normalizeCriteria(previous), previous);
});

test('IDs de tarefa não são reutilizados depois de excluir a tarefa mais recente', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'devdesk-ids-'));
  const project = path.join(root, '.devdesk');
  const tasks = path.join(project, 'tasks');
  await fs.mkdir(tasks, { recursive: true });
  try {
    assert.equal(await nextTaskId(tasks), 'TASK-001');
    await fs.writeFile(path.join(tasks, 'TASK-001.md'), '# tarefa\n');
    assert.equal(await nextTaskId(tasks), 'TASK-002');
    await fs.rm(path.join(tasks, 'TASK-002.md'), { force: true });
    assert.equal(await nextTaskId(tasks), 'TASK-003');
    const parallel = await Promise.all([nextTaskId(tasks), nextTaskId(tasks), nextTaskId(tasks)]);
    assert.deepEqual(new Set(parallel).size, 3);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test('valida nomes de projetos e resolve somente diretórios diretos', async () => {
  assert.throws(() => validateProjectName('../outside'), /inválido/i);
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'devdesk-paths-'));
  try {
    await fs.mkdir(path.join(root, 'api'));
    const dirs = await resolveProjectDirectories(root, 'api');
    assert.equal(dirs.projectPath, await fs.realpath(path.join(root, 'api')));
    await assert.rejects(resolveProjectDirectories(root, '..'), /inválido/i);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

function responseMock() {
  return {
    statusCode: 200,
    payload: null,
    status(code) { this.statusCode = code; return this; },
    json(payload) { this.payload = payload; return this; }
  };
}

test('bloqueia Host inesperado e origem cross-site em mutações', () => {
  const guard = createLocalRequestGuard({ port: 3030 });
  const next = { called: false };
  const nextFn = () => { next.called = true; };

  let res = responseMock();
  guard({ headers: { host: 'evil.example' }, method: 'GET', path: '/api/projects' }, res, nextFn);
  assert.equal(res.statusCode, 403);

  res = responseMock();
  guard({
    headers: { host: '127.0.0.1:3030', origin: 'https://evil.example', 'sec-fetch-site': 'cross-site', 'content-type': 'application/json', 'content-length': '2' },
    method: 'POST', path: '/api/config'
  }, res, nextFn);
  assert.equal(res.statusCode, 403);

  res = responseMock();
  guard({
    headers: { host: '127.0.0.1:3030', origin: 'http://127.0.0.1:3030', 'content-type': 'application/json', 'content-length': '2' },
    method: 'POST', path: '/api/config'
  }, res, nextFn);
  assert.equal(res.statusCode, 200);
  assert.equal(next.called, true);
});
