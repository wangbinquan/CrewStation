import { expect, test } from 'bun:test';
import { OpencodeProviderSchema, PlatformOpencodeModelsSchema, opencodeProviderSecretNames } from './opencodeModels';
import { LaunchSpecSchema } from './launch';
import { BusinessNativeConfigSchema } from '../api/business/nativeConfig';

const provider = { id: 'gateway', npm: '@ai-sdk/openai-compatible', models: { 'model-a': { name: 'A', limit: { context: 128000, output: 8192 } } }, options: { baseURL: 'https://models.example/v1' }, credentials: { apiKey: 'MODEL_KEY' } };
test('administrator provider preserves SDK, explicit model metadata and Secret references', () => {
  expect(OpencodeProviderSchema.parse(provider)).toEqual(provider);
  expect(LaunchSpecSchema.safeParse({ protocol: 'opencode', binaryPath: '/usr/bin/opencode', model: 'gateway/model-a', opencodeProvider: provider }).success).toBe(true);
  expect(LaunchSpecSchema.safeParse({ protocol: 'terminal', binaryPath: '/usr/bin/tool', opencodeProvider: provider }).success).toBe(false);
  for (const options of [{ apiKey: 'plaintext' }, { nested: { authorization: 'secret' } }, { baseURL: '{env:MY_ENDPOINT}' }, { certificate: '{file:/secret}' }]) expect(OpencodeProviderSchema.safeParse({ ...provider, options }).success).toBe(false);
  expect(OpencodeProviderSchema.safeParse({ ...provider, npm: 'file:///tmp/provider.mjs' }).success).toBe(false);
  expect(OpencodeProviderSchema.safeParse({ ...provider, models: {} }).success).toBe(false);
  for (const unsafe of ['{"__proto__":{"polluted":true}}', '{"nested":{"__proto__":{"polluted":true}}}', '{"constructor":{"prototype":{"polluted":true}}}']) {
    expect(OpencodeProviderSchema.safeParse({ ...provider, options: JSON.parse(unsafe) }).success).toBe(false);
    expect(OpencodeProviderSchema.safeParse({ ...provider, models: JSON.parse(unsafe) }).success).toBe(false);
  }
  expect(OpencodeProviderSchema.safeParse({ ...provider, options: Object.create({ polluted: true }) }).success).toBe(false);
});
test('existing Unicode provider identities remain valid while separators and control bytes are rejected', () => {
  const original = { ...provider, id: '火山AI网关' };
  expect(LaunchSpecSchema.parse({ protocol: 'opencode', binaryPath: '/usr/bin/opencode', model: '火山AI网关/model-a', opencodeProvider: original }).opencodeProvider).toEqual(original);
  for (const id of ['bad/provider', 'bad provider', 'bad\\provider', 'bad\nprovider', '__proto__']) expect(OpencodeProviderSchema.safeParse({ ...provider, id }).success).toBe(false);
});
test('only OpenCode subagents can reference a platform profile; root and business compiled material remain rejected', () => {
  const id = Bun.randomUUIDv7(), agent = { name: 'root', body: '', options: {} }, child = { name: 'child', body: '', options: {}, agentProfileId: id };
  const native = { version: 1, protocol: 'opencode', agent, subagents: [child], mcp: [], plugins: [] };
  expect(BusinessNativeConfigSchema.parse(native).subagents[0]?.agentProfileId).toBe(id);
  expect(BusinessNativeConfigSchema.safeParse({ ...native, agent: { ...agent, agentProfileId: id } }).success).toBe(false);
  expect(BusinessNativeConfigSchema.safeParse({ ...native, protocol: 'claude-code' }).success).toBe(false);
  expect(BusinessNativeConfigSchema.safeParse({ ...native, platformOpencodeModels: {} }).success).toBe(false);
  expect(BusinessNativeConfigSchema.safeParse({ ...native, subagents: [{ ...child, agentProfileId: 'default' }] }).success).toBe(false);
  expect(PlatformOpencodeModelsSchema.safeParse({ version: 1, root: 'gateway/model-a', providers: {}, subagents: {}, identities: {}, arbitrary: 'forbidden' }).success).toBe(false);
});

// RFC-040 V12: platform code forwards structured provider material plus only its declared
// secret values; agent-drivers is the single renderer. The rendered v1 wire is no longer accepted.
test('platform model material v2 carries structured providers with only declared secrets and rejects the rendered v1 wire', () => {
  const identity = { model: 'gateway/model-a', computeProfileId: Bun.randomUUIDv7(), revision: 1 };
  const material = { version: 2, root: 'cs-platform-a/model-a', subagents: { child: 'cs-platform-a/model-a' }, providers: { 'cs-platform-a': { provider, secrets: { MODEL_KEY: 'value' } } }, identities: { 'cs-platform-a/model-a': identity } };
  expect(PlatformOpencodeModelsSchema.parse(material).providers['cs-platform-a']?.provider.credentials).toEqual({ apiKey: 'MODEL_KEY' });
  expect(PlatformOpencodeModelsSchema.safeParse({ ...material, version: 1 }).success).toBe(false);
  const rendered = { npm: provider.npm, models: provider.models, options: { ...provider.options, apiKey: 'value' }, whitelist: ['model-a'] };
  expect(PlatformOpencodeModelsSchema.safeParse({ ...material, providers: { 'cs-platform-a': rendered } }).success).toBe(false);
  expect(PlatformOpencodeModelsSchema.safeParse({ ...material, providers: { 'cs-platform-a': { provider, secrets: { 'bad name': 'value' } } } }).success).toBe(false);
  expect(opencodeProviderSecretNames({ credentials: { apiKey: 'MODEL_KEY', headers: { 'x-a': 'HEADER_KEY', 'x-b': 'MODEL_KEY' } } })).toEqual(['HEADER_KEY', 'MODEL_KEY']);
  expect(opencodeProviderSecretNames({ credentials: {} })).toEqual([]);
});
