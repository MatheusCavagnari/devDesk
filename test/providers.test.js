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
