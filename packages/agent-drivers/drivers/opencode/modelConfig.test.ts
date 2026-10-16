import { expect, test } from 'bun:test';
import { BusinessNativeConfigSchema, LaunchSpecSchema, OpencodeProviderSchema } from '@crewstation/contracts';
import type { PlatformOpencodeModels } from '@crewstation/contracts';
import type { AgentSpawnContext } from '../../contract/spawnPlan';
import { launchSpawnFields } from '../../contract/spawnPlan';
import { buildOpencodeInlineConfig } from './inlineConfig';
import { buildOpencodeNativeEnv } from './nativeEnv';
import { opencodeModelConfig, opencodeOriginalModels, renderOpencodeProvider } from './modelConfig';

function fixture() {
  const id = Bun.randomUUIDv7(), childId = Bun.randomUUIDv7();
  const native = BusinessNativeConfigSchema.parse({ version: 1, protocol: 'opencode', agent: { name: 'root', body: 'root body' }, subagents: [{ name: 'child', body: 'child body', agentProfileId: childId }, { name: 'inherit', body: '' }] });
  // Both aliases reuse the administrator's provider id "same": isolation comes from the platform alias, not the provider name.
  const provider = (endpoint: string, model: string) => OpencodeProviderSchema.parse({ id: 'same', npm: '@ai-sdk/openai-compatible', options: { baseURL: endpoint }, models: { [model]: { name: model }, unused: { name: 'unused' } }, credentials: { apiKey: 'MODEL_KEY' } });
  const models: PlatformOpencodeModels = { version: 2, root: 'cs-platform-root/a', subagents: { child: 'cs-platform-child/b' },
    providers: { 'cs-platform-root': { provider: provider('https://a.example', 'a'), secrets: { MODEL_KEY: 'key-a' } }, 'cs-platform-child': { provider: provider('https://b.example', 'b'), secrets: { MODEL_KEY: 'key-b' } } },
    identities: { 'cs-platform-root/a': { model: 'same/a', computeProfileId: id, revision: 1 }, 'cs-platform-child/b': { model: 'same/b', computeProfileId: childId, revision: 4 } } };
  const ctx: AgentSpawnContext = { agentId: id, businessNativeConfig: native, platformOpencodeModels: models, head: ['/usr/bin/opencode'], prompt: '', model: 'same/a', permission: 'full', mcps: [], cwd: '/work', runDir: '/run/private', baseEnv: {} };
  return { ctx, models };
}
test('each internal agent gets its selected alias, inherited model uses root, allowlist retains both isolated gateways', () => {
  const { ctx, models } = fixture(), config = buildOpencodeInlineConfig(ctx);
  expect(config.agent.root?.model).toBe(models.root);
  expect(config.agent.child?.model).toBe(models.subagents.child);
  expect(config.agent.inherit?.model).toBe(models.root);
  expect(config.agent.child).not.toHaveProperty('agentProfileId');
  const platform = opencodeModelConfig(ctx);
  expect(platform).toMatchObject({ model: models.root, small_model: models.root, enabled_providers: ['cs-platform-root', 'cs-platform-child'],
    provider: { 'cs-platform-root': { npm: '@ai-sdk/openai-compatible', options: { baseURL: 'https://a.example', apiKey: 'key-a' }, models: { a: { name: 'a' } }, whitelist: ['a'] },
      'cs-platform-child': { options: { baseURL: 'https://b.example', apiKey: 'key-b' }, models: { b: { name: 'b' } }, whitelist: ['b'] } } });
  // Only selected models are rendered; the alias never exposes the administrator's other models.
  expect(JSON.stringify(platform)).not.toContain('unused');
  expect(JSON.parse(buildOpencodeNativeEnv(ctx, '/run/private/config').OPENCODE_CONFIG_CONTENT!)).toMatchObject(platform);
  expect(opencodeOriginalModels(ctx)).toEqual({ 'cs-platform-root/a': 'same/a', 'cs-platform-child/b': 'same/b' });
});
test('missing, foreign, unlisted and credential-less model mappings fail closed instead of falling back', () => {
  const f = fixture();
  expect(() => opencodeModelConfig({ ...f.ctx, platformOpencodeModels: undefined })).toThrow('固定平台');
  f.models.subagents.foreign = f.models.root; expect(() => opencodeModelConfig(f.ctx)).toThrow('不一致'); delete f.models.subagents.foreign;
  const child = f.models.providers['cs-platform-child']!;
  f.models.subagents.child = 'cs-platform-child/different'; expect(() => opencodeModelConfig(f.ctx)).toThrow('不完整'); f.models.subagents.child = 'cs-platform-child/b';
  child.secrets = {}; expect(() => opencodeModelConfig(f.ctx)).toThrow('缺少声明的凭据');
});
test('standalone profile tests and terminals use the same single renderer with declared credentials', () => {
  const f = fixture(), launch = LaunchSpecSchema.parse({ protocol: 'opencode', binaryPath: '/bin/opencode', model: 'gateway/m', opencodeProvider: { id: 'gateway', npm: '@ai-sdk/openai-compatible', models: { m: { name: 'M' } }, options: { baseURL: 'https://model.example/v1', headers: { 'x-client': 'crewstation' } }, credentials: { apiKey: 'KEY', headers: { Authorization: 'AUTH' } } } });
  const ctx: AgentSpawnContext = { ...f.ctx, businessNativeConfig: undefined, platformOpencodeModels: undefined, ...launchSpawnFields(launch), baseEnv: { KEY: 'pinned-secret', AUTH: 'Bearer pinned-auth' } };
  const rendered = opencodeModelConfig(ctx);
  expect(rendered).toMatchObject({ provider: { gateway: { models: { m: { name: 'M' } }, whitelist: ['m'], options: { apiKey: 'pinned-secret', headers: { 'x-client': 'crewstation', Authorization: 'Bearer pinned-auth' } } } } });
  expect((rendered.provider as Record<string, unknown>).gateway).toEqual(renderOpencodeProvider(launch.opencodeProvider!, ['m'], (name) => ({ KEY: 'pinned-secret', AUTH: 'Bearer pinned-auth' })[name]!));
  expect(() => opencodeModelConfig({ ...ctx, baseEnv: {} })).toThrow('缺少');
  expect(() => opencodeModelConfig({ ...ctx, model: 'other/m' })).toThrow('没有档位模型');
  expect(opencodeModelConfig({ ...ctx, opencodeProvider: undefined })).toEqual({});
});
