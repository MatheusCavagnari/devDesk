const REQUIRED_STRING_FIELDS = ['id', 'name', 'command', 'description'];

export function validateProvider(provider) {
  if (!provider || typeof provider !== 'object') throw new TypeError('Provider deve ser um objeto.');
  for (const field of REQUIRED_STRING_FIELDS) {
    if (typeof provider[field] !== 'string' || !provider[field].trim()) {
      throw new TypeError('Provider inválido: campo ' + field + ' obrigatório.');
    }
  }
  if (!Array.isArray(provider.platforms) || provider.platforms.length === 0 ||
      provider.platforms.some(platform => typeof platform !== 'string' || !platform.trim())) {
    throw new TypeError('Provider inválido: informe as plataformas suportadas.');
  }
  if (typeof provider.buildCliArguments !== 'function') {
    throw new TypeError('Provider inválido: buildCliArguments deve ser uma função.');
  }
  return provider;
}

export function buildProviderArguments(provider, context) {
  validateProvider(provider);
  const args = provider.buildCliArguments(context);
  if (!Array.isArray(args) || args.some(arg => typeof arg !== 'string')) {
    throw new TypeError('Provider ' + provider.id + ' deve retornar uma lista de argumentos string.');
  }
  return args;
}
