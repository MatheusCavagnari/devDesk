import test from 'node:test';
import assert from 'node:assert/strict';
import { TaskService } from '../src/application/tasks/task-service.js';
import { createTaskEntity, TaskValidationError } from '../src/domain/tasks/task.js';

function makeDependencies() {
  const projects = new Map([['api', { name: 'api', projectPath: '/projects/api' }], ['web', { name: 'web', projectPath: '/projects/web' }]]);
  const tasks = new Map();
  let nextId = 1;
  const projectRepository = {
    async getProject(name) { const project = projects.get(name); if (!project) throw new Error('Projeto não encontrado.'); return project; },
    async listProjects() { return [...projects.keys()].map(name => ({ name })); },
    async validateRoot(value) { return value; }
  };
  const taskRepository = {
    async nextTaskId() { return 'TASK-' + String(nextId++).padStart(3, '0'); },
    async getTask(project, id) { const task = tasks.get(project + ':' + id); if (!task) { const e = new Error('Tarefa não encontrada: ' + id); e.code = 'TASK_NOT_FOUND'; throw e; } return structuredClone(task); },
    async listTasks(project) { return [...tasks.values()].filter(task => task.project === project).map(task => structuredClone(task)); },
    async saveTask(task, { createOnly = false } = {}) { const key = task.project + ':' + task.id; if (createOnly && tasks.has(key)) throw new Error('Tarefa já existe.'); tasks.set(key, structuredClone(task)); },
    async deleteTask(project, id) { tasks.delete(project + ':' + id); }
  };
  return { service: new TaskService({ taskRepository, projectRepository, clock: () => '2026-10-11T00:00:00.000Z' }), tasks };
}

test('domínio rejeita título vazio e normaliza IDs/projetos', () => {
  assert.throws(() => createTaskEntity({ id: 'bad', project: 'api', input: { title: '' }, targetProjects: ['api'], now: 'now' }), TaskValidationError);
  const task = createTaskEntity({ id: 'task-001', project: 'api', input: { title: ' Tarefa ', acceptanceCriteria: 'A\nB' }, targetProjects: ['web', 'api'], now: 'now' });
  assert.equal(task.id, 'TASK-001');
  assert.deepEqual(task.targetProjects, ['api', 'web']);
  assert.equal(task.title, 'Tarefa');
});

test('TaskService cria, atualiza, gera prompt e exclui usando ports', async () => {
  const { service } = makeDependencies();
  const created = await service.createTask('api', { title: 'Endpoint', description: 'Criar endpoint', acceptanceCriteria: 'Retornar 200', targetProjects: ['web'] });
  assert.equal(created.tasks.length, 1);
  assert.equal(created.tasks[0].id, 'TASK-001');
  const updated = await service.updateTask('api', 'TASK-001', { status: 'done', acceptanceCriteria: 'Retornar 200\nTer teste' });
  assert.equal(updated.tasks[0].status, 'done');
  const prompt = await service.buildAgentPrompt('api', 'TASK-001');
  assert.match(prompt.prompt, /Endpoint/);
  assert.equal(prompt.projectPaths.length, 2);
  const deleted = await service.deleteTask('api', 'TASK-001');
  assert.match(deleted.message, /removida/);
  assert.equal((await service.listTasks('api')).length, 0);
});

test('TaskService rejeita projeto-alvo desconhecido', async () => {
  const { service } = makeDependencies();
  await assert.rejects(service.createTask('api', { title: 'Tarefa', targetProjects: ['missing'] }), /Projeto não encontrado/);
});
