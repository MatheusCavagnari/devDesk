import test from 'node:test';
import assert from 'node:assert/strict';
import { getProvider, listProviders } from '../src/agents/providers.js';
import { buildProviderArguments, validateProvider } from '../src/agents/provider-contract.js';

test('o registro lista o GitHub Copilot CLI', () => {
  const providers = listProviders();
  assert.ok(providers.some(provider => provider.id === 'copilot-cli'));
});

test('um provider desconhecido não é encontrado', () => {
  assert.equal(getProvider('provider-inexistente'), null);
});

test('o provider preserva prompt e múltiplos diretórios como argumentos separados', () => {
  const provider = getProvider('copilot-cli');
  const args = provider.buildCliArguments({
    prompt: 'Corrigir o frontend e o backend',
    targetPaths: ['C:\\Projetos\\api principal', 'C:\\Projetos\\web']
  });
  assert.equal(args[0], '-p');
  assert.equal(args[1], 'Corrigir o frontend e o backend');
  assert.equal(args.filter(arg => arg === '--add-dir').length, 2);
  assert.ok(args.includes('C:\\Projetos\\api principal'));
  assert.ok(args.includes('C:\\Projetos\\web'));
  assert.ok(args.includes('--allow-tool=write,shell'));
});

test('Codex CLI usa sandbox workspace-write e adiciona projetos secundários', () => {
  const provider = getProvider('codex-cli');
  assert.ok(provider);
  const args = provider.buildCliArguments({
    prompt: 'Implementar integração',
    primaryPath: 'C:\\Projetos\\api',
    targetPaths: ['C:\\Projetos\\api', 'C:\\Projetos\\web']
  });
  assert.ok(args.includes('exec'));
  assert.ok(args.includes('--sandbox'));
  assert.ok(args.includes('workspace-write'));
  assert.ok(args.includes('--add-dir'));
  assert.ok(args.includes('C:\\Projetos\\web'));
});

test('todos os providers registrados cumprem o contrato comum', () => {
  for (const provider of listProviders()) {
    const full = getProvider(provider.id);
    assert.doesNotThrow(() => validateProvider(full));
    const args = buildProviderArguments(full, {
      prompt: 'Teste de contrato',
      targetPaths: ['C:\\Projetos\\api'],
      primaryPath: 'C:\\Projetos\\api'
    });
    assert.ok(Array.isArray(args));
    assert.ok(args.every(arg => typeof arg === 'string'));
  }
});

test('o contrato rejeita providers incompletos e argumentos inválidos', () => {
  assert.throws(() => validateProvider({ id: 'bad' }), /obrigatório|plataformas/i);
  const provider = {
    id: 'bad', name: 'Bad', command: 'bad', description: 'Bad provider',
    platforms: ['win32'], buildCliArguments: () => ['ok', 123]
  };
  assert.throws(() => buildProviderArguments(provider, {}), /lista de argumentos string/i);
});
