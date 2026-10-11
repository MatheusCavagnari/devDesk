import { Router } from 'express';

export function createTaskRouter({ taskRepository }) {
  const router = Router();

  router.get('/api/projects/:project/tasks', async (req, res) => {
    try { res.json({ tasks: await taskRepository.listTasks(req.params.project) }); }
    catch (error) { res.status(error.statusCode || 400).json({ error: error.message }); }
  });

  router.post('/api/projects/:project/tasks', async (req, res) => {
    try {
      const result = await taskRepository.createTask(req.params.project, req.body);
      res.status(201).json(result);
    } catch (error) { res.status(error.statusCode || 400).json({ error: error.message }); }
  });

  router.patch('/api/projects/:project/tasks/:id', async (req, res) => {
    try { res.json(await taskRepository.updateTask(req.params.project, req.params.id, req.body)); }
    catch (error) { res.status(error.statusCode || 400).json({ error: error.message }); }
  });

  router.delete('/api/projects/:project/tasks/:id', async (req, res) => {
    try { res.json(await taskRepository.deleteTask(req.params.project, req.params.id)); }
    catch (error) { res.status(error.statusCode || 400).json({ error: error.message }); }
  });

  router.get('/api/projects/:project/tasks/:id/agent-prompt', async (req, res) => {
    try { res.json(await taskRepository.buildAgentPrompt(req.params.project, req.params.id)); }
    catch (error) { res.status(error.statusCode || 400).json({ error: error.message }); }
  });

  return router;
}
