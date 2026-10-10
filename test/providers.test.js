import test from 'node:test';
import assert from 'node:assert/strict';
import { getProvider, listProviders } from '../src/agents/providers.js';

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
  assert.ok(args.includes('--add-dir=C:\\Projetos\\api principal'));
  assert.ok(args.includes('--add-dir=C:\\Projetos\\web'));
  assert.ok(args.includes('--allow-tool=write,shell'));
});
