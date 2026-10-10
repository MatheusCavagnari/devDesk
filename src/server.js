import express from 'express';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';

const app = express();
const PORT = Number(process.env.PORT || 3030);
const here = path.dirname(fileURLToPath(import.meta.url));
let projectsRoot = '';

app.use(express.json({ limit: '256kb' }));
app.use(express.static(path.join(here, 'public')));

const safeName = (value) => String(value ?? '').trim().replace(/[<>:"/\\|?*\x00-\x1F]/g, '-').replace(/[. ]+$/g, '').slice(0, 100);
const exists = async (file) => { try { await fs.access(file); return true; } catch { return false; } };

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
  const title = content.match(/^# (.+)$/m)?.[1] || path.basename(file, '.md');
  const description = content.match(/## Objetivo\n([\s\S]*?)(?=\n## |$)/)?.[1]?.trim() || '';
  const criteria = [...content.matchAll(/^- \[([ xX])\] (.+)$/gm)].map(m => ({ text: m[2], done: m[1].toLowerCase() === 'x' }));
  return { id: field('id') || path.basename(file, '.md'), title, description, status: field('status') || 'backlog', priority: field('priority') || 'medium', createdAt: field('created'), updatedAt: field('updated'), criteria };
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
app.post('/api/config', async (req, res) => {
  try {
    const raw = String(req.body?.projectsRoot || '').trim();
    if (!raw || !path.isAbsolute(raw)) return res.status(400).json({ error: 'Informe um caminho absoluto.' });
    const full = path.resolve(raw);
    const stat = await fs.stat(full).catch(() => null);
    if (!stat?.isDirectory()) return res.status(400).json({ error: 'A pasta não existe ou não é uma pasta.' });
    projectsRoot = await fs.realpath(full);
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
    const task = { id, title, description: String(req.body?.description || '').trim(), acceptanceCriteria: String(req.body?.acceptanceCriteria || ''), priority, status, createdAt: now, updatedAt: now };
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
    const t = { id, title, description: String(req.body?.description ?? old.description).trim(), acceptanceCriteria: String(req.body?.acceptanceCriteria ?? old.criteria.map(c => c.text).join('\n')), priority: ['low','medium','high','urgent'].includes(req.body?.priority) ? req.body.priority : old.priority, status: ['backlog','todo','in_progress','blocked','done'].includes(req.body?.status) ? req.body.status : old.status, createdAt: old.createdAt || new Date().toISOString(), updatedAt: new Date().toISOString() };
    await fs.writeFile(file, toMarkdown(t), 'utf8');
    res.json({ tasks: await syncIndex(req.params.project), message: id + ' atualizada.' });
  } catch (e) { res.status(400).json({ error: e.message }); }
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

app.listen(PORT, '127.0.0.1', () => console.log(`DevDesk disponível em http://127.0.0.1:${PORT}`));
