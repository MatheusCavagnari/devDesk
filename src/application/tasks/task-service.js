import { buildTaskPrompt, createTaskEntity, normalizeTargetProjects, updateTaskEntity } from '../../domain/tasks/task.js';
import { assertTaskRepository } from '../ports/task-repository.js';
import { assertProjectRepository } from '../ports/project-repository.js';

export class TaskService {
  constructor({ taskRepository, projectRepository, clock = () => new Date().toISOString() }) {
    assertTaskRepository(taskRepository);
    assertProjectRepository(projectRepository);
    this.taskRepository = taskRepository;
    this.projectRepository = projectRepository;
    this.clock = clock;
  }

  async resolveTargets(primaryProject, requestedProjects) {
    const names = normalizeTargetProjects(primaryProject, requestedProjects);
    for (const name of names) await this.projectRepository.getProject(name);
    return names;
  }

  async listTasks(project) {
    return this.taskRepository.listTasks(project);
  }

  async createTask(project, input = {}) {
    const targetProjects = await this.resolveTargets(project, input.targetProjects);
    const now = this.clock();
    // Valide os campos antes de reservar um ID permanente.
    const validatedTask = createTaskEntity({
      id: 'TASK-000',
      project,
      input,
      targetProjects,
      now
    });
    const id = await this.taskRepository.nextTaskId(project);
    const task = { ...validatedTask, id };
    await this.taskRepository.saveTask(task, { createOnly: true });
    return { tasks: await this.taskRepository.listTasks(project), message: id + ' criada.' };
  }

  async updateTask(project, taskId, input = {}) {
    const existing = await this.taskRepository.getTask(project, taskId);
    const requestedProjects = input.targetProjects === undefined ? existing.targetProjects : input.targetProjects;
    const targetProjects = await this.resolveTargets(project, requestedProjects);
    const task = updateTaskEntity(existing, input, targetProjects, this.clock());
    await this.taskRepository.saveTask(task);
    return { tasks: await this.taskRepository.listTasks(project), message: task.id + ' atualizada.' };
  }

  async deleteTask(project, taskId) {
    const existing = await this.taskRepository.getTask(project, taskId);
    await this.taskRepository.deleteTask(project, existing.id);
    return { tasks: await this.taskRepository.listTasks(project), message: existing.id + ' removida.' };
  }

  async buildAgentPrompt(project, taskId) {
    const task = await this.taskRepository.getTask(project, taskId);
    const targetProjects = await this.resolveTargets(project, task.targetProjects);
    const projectPaths = await Promise.all(targetProjects.map(async name => {
      const directory = await this.projectRepository.getProject(name);
      return { name, path: directory.projectPath };
    }));
    return { prompt: buildTaskPrompt(task, project, projectPaths), targetProjects, projectPaths };
  }
}
