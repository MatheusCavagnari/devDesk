const providers = [
  {
    id: 'copilot-cli',
    name: 'GitHub Copilot CLI',
    command: 'copilot',
    description: 'Executa a tarefa pelo Copilot CLI com permissões de escrita e shell.',
    platforms: ['win32'],
    buildCliArguments({ prompt, targetPaths }) {
      return [
        '-p',
        prompt,
        '-s',
        ...targetPaths.flatMap(directory => ['--add-dir', directory]),
        '--allow-tool=write,shell'
      ];
    }
  },
  {
    id: 'codex-cli',
    name: 'OpenAI Codex CLI',
    command: 'codex',
    description: 'Executa a tarefa em modo não interativo, com sandbox workspace-write.',
    platforms: ['win32'],
    buildCliArguments({ prompt, targetPaths, primaryPath }) {
      const additionalPaths = targetPaths.filter(directory => directory !== primaryPath);
      return [
        'exec',
        '--cd', primaryPath,
        '--sandbox', 'workspace-write',
        '--ask-for-approval', 'never',
        ...additionalPaths.flatMap(directory => ['--add-dir', directory]),
        prompt
      ];
    }
  }
];

export function listProviders() {
  return providers.map(({ id, name, description, platforms }) => ({ id, name, description, platforms }));
}

export function getProvider(id) {
  return providers.find(provider => provider.id === id) || null;
}
