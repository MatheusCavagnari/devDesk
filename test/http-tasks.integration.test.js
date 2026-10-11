import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import net from 'node:net';
import { spawn } from 'node:child_process';

async function freePort() {
  const server = net.createServer();
  await new Promise((resolve, reject) => server.listen(0, '127.0.0.1', error => error ? reject(error) : resolve()));
  const port = server.address().port;
  await new Promise(resolve => server.close(resolve));
  return port;
}

async function waitForServer(baseUrl, child) {
  const deadline = Date.now() + 15000;
  let lastError;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) throw new Error('DevDesk encerrou antes de iniciar, código ' + child.exitCode);
    try {
      const response = await fetch(baseUrl + '/api/config');
      if (response.ok) return;
      lastError = new Error('HTTP ' + response.status);
    } catch (error) { lastError = error; }
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  throw new Error('DevDesk não iniciou: ' + lastError);
}

async function startDevDesk(t) {
  const temp = await fs.mkdtemp(path.join(os.tmpdir(), 'devdesk-http-'));
  const port = await freePort();
  const baseUrl = 'http://127.0.0.1:' + port;
  const env = {
    ...process.env,
    PORT: String(port),
    HOME: temp,
    USERPROFILE: temp,
    DEVDESK_RUN_TIMEOUT_MS: '1000'
  };
  const child = spawn(process.execPath, ['src/server.js'], {
    cwd: process.cwd(),
    env,
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true
  });
  let stdout = '';
  let stderr = '';
  child.stdout.setEncoding('utf8').on('data', chunk => { stdout += chunk; });
  child.stderr.setEncoding('utf8').on('data', chunk => { stderr += chunk; });
  t.after(async () => {
    if (child.exitCode === null && child.signalCode === null) {
      child.kill();
      await Promise.race([
        new Promise(resolve => child.once('exit', resolve)),
        new Promise(resolve => setTimeout(resolve, 3000))
      ]);
    }
    await fs.rm(temp, { recursive: true, force: true });
  });
  await waitForServer(baseUrl, child).catch(error => {
    throw new Error(error.message + '\nstdout: ' + stdout + '\nstderr: ' + stderr);
  });
  return { baseUrl, temp };
}

async function request(baseUrl, route, { method = 'GET', body } = {}) {
  const response = await fetch(baseUrl + route, {
    method,
    headers: body === undefined ? {} : { 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body)
  });
  const raw = await response.text();
  let data;
  try { data = JSON.parse(raw); } catch { data = raw; }
  return { status: response.status, data };
}

test('HTTP: configuração, CRUD de tarefas, Markdown e índice sincronizado', async t => {
  const { baseUrl, temp } = await startDevDesk(t);
  const projectsRoot = path.join(temp, 'projects');
  const apiDir = path.join(projectsRoot, 'api');
  const webDir = path.join(projectsRoot, 'web');
  await fs.mkdir(apiDir, { recursive: true });
  await fs.mkdir(webDir, { recursive: true });

  const configured = await request(baseUrl, '/api/config', {
    method: 'POST', body: { projectsRoot }
  });
  assert.equal(configured.status, 200);
  assert.equal(configured.data.projectsRoot, await fs.realpath(projectsRoot));

  const projects = await request(baseUrl, '/api/projects');
  assert.equal(projects.status, 200);
  assert.deepEqual(projects.data.projects.map(item => item.name), ['api', 'web']);

  const invalid = await request(baseUrl, '/api/projects/api/tasks', {
    method: 'POST', body: { title: '   ' }
  });
  assert.equal(invalid.status, 400);

  const created = await request(baseUrl, '/api/projects/api/tasks', {
    method: 'POST',
    body: {
      title: 'Criar endpoint de saúde',
      description: 'Endpoint para verificar a API',
      acceptanceCriteria: 'Responder HTTP 200\nRetornar JSON válido',
      priority: 'high',
      status: 'todo',
      targetProjects: ['web']
    }
  });
  assert.equal(created.status, 201, JSON.stringify(created.data));
  assert.match(created.data.message, /TASK-001 criada/);
  assert.equal(created.data.tasks.length, 1);
  assert.deepEqual(created.data.tasks[0].targetProjects, ['api', 'web']);

  const taskFile = path.join(apiDir, '.devdesk', 'tasks', 'TASK-001.md');
  const markdownAfterCreate = await fs.readFile(taskFile, 'utf8');
  assert.match(markdownAfterCreate, /title: "Criar endpoint de saúde"/);
  assert.match(markdownAfterCreate, /projects: \["api","web"\]/);
  assert.match(await fs.readFile(path.join(apiDir, '.devdesk', 'TASKS.md'), 'utf8'), /Criar endpoint de saúde/);

  const prompt = await request(baseUrl, '/api/projects/api/tasks/TASK-001/agent-prompt');
  assert.equal(prompt.status, 200);
  assert.match(prompt.data.prompt, /Projetos autorizados para esta tarefa/);
  assert.match(prompt.data.prompt, /Criar endpoint de saúde/);
  assert.equal(prompt.data.projectPaths.length, 2);

  const updated = await request(baseUrl, '/api/projects/api/tasks/TASK-001', {
    method: 'PATCH',
    body: {
      title: 'Criar endpoint de saúde v2',
      acceptanceCriteria: 'Responder HTTP 200\nRetornar JSON válido\nCobrir com teste',
      status: 'in_progress'
    }
  });
  assert.equal(updated.status, 200, JSON.stringify(updated.data));
  assert.equal(updated.data.tasks[0].status, 'in_progress');
  const markdownAfterUpdate = await fs.readFile(taskFile, 'utf8');
  assert.match(markdownAfterUpdate, /- \[ \] Responder HTTP 200/);
  assert.match(markdownAfterUpdate, /- \[ \] Cobrir com teste/);
  assert.match(await fs.readFile(path.join(apiDir, '.devdesk', 'TASKS.md'), 'utf8'), /Criar endpoint de saúde v2/);

  const deleted = await request(baseUrl, '/api/projects/api/tasks/TASK-001', { method: 'DELETE' });
  assert.equal(deleted.status, 200);
  assert.match(deleted.data.message, /TASK-001 removida/);
  await assert.rejects(fs.access(taskFile));
  assert.doesNotMatch(await fs.readFile(path.join(apiDir, '.devdesk', 'TASKS.md'), 'utf8'), /Criar endpoint de saúde/);

  const missing = await request(baseUrl, '/api/projects/api/tasks/TASK-001');
  assert.equal(missing.status, 404);
});

test('HTTP: bloqueia projeto com caminho inválido e origem externa', async t => {
  const { baseUrl, temp } = await startDevDesk(t);
  const projectsRoot = path.join(temp, 'projects');
  await fs.mkdir(path.join(projectsRoot, 'api'), { recursive: true });
  assert.equal((await request(baseUrl, '/api/config', { method: 'POST', body: { projectsRoot } })).status, 200);

  const invalidPath = await request(baseUrl, '/api/projects/%2E%2E/tasks');
  assert.equal(invalidPath.status, 400);

  const hostile = await fetch(baseUrl + '/api/config', {
    method: 'POST',
    headers: { 'content-type': 'application/json', origin: 'https://evil.example' },
    body: JSON.stringify({ projectsRoot })
  });
  assert.equal(hostile.status, 403);
});
