import fs from 'node:fs/promises';
import path from 'node:path';

export function validateProjectName(value) {
  const name = String(value ?? '').trim();
  if (!name || name.length > 100 || name === '.' || name === '..' ||
      /[<>:"/\\|?*\x00-\x1F]/.test(name) || /[. ]$/.test(name)) {
    throw new Error('Nome de projeto inválido.');
  }
  return name;
}

export async function resolveProjectDirectories(projectsRoot, value) {
  if (!projectsRoot) throw new Error('Configure a pasta raiz primeiro.');
  const name = validateProjectName(value);
  if (name !== value) throw new Error('Nome de projeto inválido.');

  const realRoot = await fs.realpath(projectsRoot);
  const folder = path.resolve(realRoot, name);
  if (path.dirname(folder) !== realRoot) throw new Error('Projeto fora da raiz permitida.');

  const folderStat = await fs.lstat(folder).catch(() => null);
  if (!folderStat?.isDirectory() || folderStat.isSymbolicLink()) {
    throw new Error('A pasta do projeto não existe ou não pode ser um link simbólico.');
  }
  const realFolder = await fs.realpath(folder);
  if (path.dirname(realFolder) !== realRoot) throw new Error('O projeto precisa ser uma pasta direta da raiz.');

  const desk = path.join(realFolder, '.devdesk');
  const tasksDir = path.join(desk, 'tasks');
  for (const directory of [desk, tasksDir]) {
    const stat = await fs.lstat(directory).catch(() => null);
    if (stat && (!stat.isDirectory() || stat.isSymbolicLink())) {
      throw new Error('As pastas .devdesk e .devdesk/tasks devem ser diretórios reais, não links simbólicos.');
    }
    if (stat) {
      const realDirectory = await fs.realpath(directory);
      if (realDirectory !== directory) throw new Error('Diretório de tarefas fora do projeto permitido.');
    }
  }
  return { name, projectPath: realFolder, desk, tasksDir };
}
