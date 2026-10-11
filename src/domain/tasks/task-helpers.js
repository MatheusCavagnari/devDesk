import fs from 'node:fs/promises';
import path from 'node:path';

const allocationLocks = new Map();

export function normalizeCriteria(input, previous = []) {
  if (Array.isArray(input)) {
    return input
      .filter(item => item && typeof item.text === 'string')
      .map(item => ({ text: item.text.trim(), done: Boolean(item.done) }))
      .filter(item => item.text.length > 0);
  }

  const oldByText = new Map(
    (Array.isArray(previous) ? previous : [])
      .filter(item => item && typeof item.text === 'string')
      .map(item => [item.text.trim(), Boolean(item.done)])
  );

  return String(input || '')
    .split(/\r?\n/)
    .map(line => line.trim())
    .filter(Boolean)
    .map(line => line.replace(/^[-*]\s*/, '').replace(/^\[[ xX]\]\s*/, '').trim())
    .filter(Boolean)
    .map(text => ({ text, done: oldByText.get(text) || false }));
}

async function allocateTaskId(tasksDir) {
  await fs.mkdir(tasksDir, { recursive: true });
  const names = await fs.readdir(tasksDir);
  const maxFileId = names
    .filter(name => /^TASK-\d+\.md$/i.test(name))
    .reduce((max, name) => Math.max(max, Number(name.match(/^TASK-(\d+)\.md$/i)?.[1] || 0)), 0);
  const sequenceFile = path.join(path.dirname(tasksDir), 'task-sequence.json');
  let saved = 0;
  try {
    const data = JSON.parse(await fs.readFile(sequenceFile, 'utf8'));
    if (Number.isSafeInteger(data.lastId) && data.lastId >= 0) saved = data.lastId;
  } catch {
    // Migration: derive the first sequence from task files that still exist.
  }

  const next = Math.max(maxFileId, saved) + 1;
  const temp = sequenceFile + '.tmp';
  await fs.writeFile(temp, JSON.stringify({ lastId: next }, null, 2) + '\n', 'utf8');
  await fs.rename(temp, sequenceFile);
  return 'TASK-' + String(next).padStart(3, '0');
}

export async function nextTaskId(tasksDir) {
  const key = path.resolve(tasksDir).toLowerCase();
  const previous = allocationLocks.get(key) || Promise.resolve();
  let release;
  const gate = new Promise(resolve => { release = resolve; });
  const tail = previous.then(() => gate);
  allocationLocks.set(key, tail);
  await previous;
  try {
    return await allocateTaskId(tasksDir);
  } finally {
    release();
    if (allocationLocks.get(key) === tail) allocationLocks.delete(key);
  }
}
