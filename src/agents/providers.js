const providers = [
  {
    id: 'copilot-cli',
    name: 'GitHub Copilot CLI',
    description: 'Executa a tarefa com o CLI instalado e autenticado no Windows.',
    platforms: ['win32'],
    buildCliArguments({ prompt, targetPaths }) {
      return [
        '-p',
        prompt,
        '-s',
        ...targetPaths.map(directory => `--add-dir=${directory}`),
        '--allow-tool=write,shell'
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
