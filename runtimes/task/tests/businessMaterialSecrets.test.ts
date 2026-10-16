import { expect, test } from 'bun:test';
import { BusinessNativeConfigSchema } from '@crewstation/contracts';
import type { AgentEvent } from '@crewstation/contracts';
import { businessMaterialSecrets } from '../src/agents/businessMaterialSecrets';
import { redactBusinessEvents } from '../src/agents/businessEventRedaction';

test('OpenCode OAuth and nested plugin values are redacted before durable events', async () => {
  const native = BusinessNativeConfigSchema.parse({ version: 1, protocol: 'opencode', agent: { name: 'root', body: '' }, mcp: [
    { name: 'local', type: 'local', command: ['tool'], env: { apiKey: 'private-env' } },
    { name: 'remote', type: 'remote', url: 'https://mcp.test', headers: { authorization: 'private-header' }, oauth: { clientId: 'public-client', clientSecret: 'private-oauth' } },
    { name: 'no-auth', type: 'remote', url: 'https://mcp.test', oauth: false },
  ], plugins: [{ name: 'plugin', entry: 'entry.js', files: [{ kind: 'file', path: 'entry.js', content: '' }], options: { nested: ['private-plugin', { again: 'private-plugin', empty: '', number: 1, enabled: true, absent: null }] } }] });
  const secrets = businessMaterialSecrets(native);
  expect(secrets).toEqual(['private-env', 'private-header', 'private-oauth', 'private-plugin']);
  expect(businessMaterialSecrets(undefined)).toEqual([]);
  const base = { agentId: 'agent', at: new Date().toISOString() };
  const input: AgentEvent[] = [
    { ...base, seq: 1, type: 'text', text: 'private-o' },
    { ...base, seq: 2, type: 'text', text: 'auth private-plugin' },
    { ...base, seq: 3, type: 'tool-start', tool: { callId: 'call', name: 'tool', input: { header: 'private-header', env: 'private-env' } } },
  ];
  const events = await Array.fromAsync(redactBusinessEvents((async function* () { yield* input; })(), secrets));
  for (const secret of secrets) expect(JSON.stringify(events)).not.toContain(secret);
  expect(events.filter((event) => event.type === 'text').map((event) => event.text).join('')).toBe('*** ***');
});


test('isolated provider credentials and option strings are removed from streamed and structured business events', async () => {
  const { PlatformOpencodeModelsSchema } = await import('@crewstation/contracts');
  const models = PlatformOpencodeModelsSchema.parse({ version: 1, root: 'cs-platform-root/m', subagents: {}, providers: { 'cs-platform-root': { npm: '@ai-sdk/openai-compatible', models: { m: { name: 'M' } }, whitelist: ['m'], options: { baseURL: 'https://private-endpoint.example', apiKey: 'private-provider-key', headers: { Authorization: 'private-provider-auth' } } } }, identities: { 'cs-platform-root/m': { model: 'original/m', computeProfileId: Bun.randomUUIDv7(), revision: 2 } } });
  const secrets = businessMaterialSecrets(undefined, models);
  expect(secrets).toContain('private-provider-key'); expect(secrets).toContain('private-provider-auth');
  const base = { agentId: 'agent', at: new Date().toISOString() };
  const input: AgentEvent[] = [{ ...base, seq: 1, type: 'text', text: 'private-provider-' }, { ...base, seq: 2, type: 'text', text: 'key' }, { ...base, seq: 3, type: 'tool-start', tool: { name: 'model', input: { auth: 'private-provider-auth' } } }];
  const events = await Array.fromAsync(redactBusinessEvents((async function* () { yield* input; })(), secrets));
  for (const secret of secrets) expect(JSON.stringify(events)).not.toContain(secret);
  expect(events.filter((event) => event.type === 'text').map((event) => event.text).join('')).toBe('***');
});
