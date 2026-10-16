import { expect, test } from 'bun:test';
import { BusinessNativeConfigSchema, LaunchSpecSchema } from '@crewstation/contracts';
import type { PlatformOpencodeModels } from '@crewstation/contracts';
import type { AgentSpawnContext } from '../../contract/spawnPlan';
import { launchSpawnFields } from '../../contract/spawnPlan';
import { buildOpencodeInlineConfig } from './inlineConfig';
import { buildOpencodeNativeEnv } from './nativeEnv';
import { opencodeModelConfig, opencodeOriginalModels } from './modelConfig';

function fixture() {
  const id = Bun.randomUUIDv7(), childId = Bun.randomUUIDv7();
  const native = BusinessNativeConfigSchema.parse({ version: 1, protocol: 'opencode', agent: { name: 'root', body: 'root body' }, subagents: [{ name: 'child', body: 'child body', agentProfileId: childId }, { name: 'inherit', body: '' }] });
  const provider = (endpoint: string, token: string, model: string) => ({ npm: '@ai-sdk/openai-compatible', options: { baseURL: endpoint, apiKey: token }, models: { [model]: { name: model } }, whitelist: [model] });
  const models: PlatformOpencodeModels = { version: 1, root: 'cs-platform-root/a', subagents: { child: 'cs-platform-child/b' }, providers: { 'cs-platform-root': provider('https://a.example', 'key-a', 'a'), 'cs-platform-child': provider('https://b.example', 'key-b', 'b') }, identities: { 'cs-platform-root/a': { model: 'same/a', computeProfileId: id, revision: 1 }, 'cs-platform-child/b': { model: 'same/b', computeProfileId: childId, revision: 4 } } };
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
  expect(platform).toMatchObject({ model: models.root, small_model: models.root, enabled_providers: ['cs-platform-root', 'cs-platform-child'], provider: models.providers });
  expect(JSON.parse(buildOpencodeNativeEnv(ctx, '/run/private/config').OPENCODE_CONFIG_CONTENT!)).toMatchObject(platform);
  expect(opencodeOriginalModels(ctx)).toEqual({ 'cs-platform-root/a': 'same/a', 'cs-platform-child/b': 'same/b' });
});
test('missing, foreign and unlisted model mappings fail closed instead of falling back', () => {
  const f = fixture();
  expect(() => opencodeModelConfig({ ...f.ctx, platformOpencodeModels: undefined })).toThrow('固定平台');
  f.models.subagents.foreign = f.models.root; expect(() => opencodeModelConfig(f.ctx)).toThrow('不一致'); delete f.models.subagents.foreign;
  f.models.providers['cs-platform-child']!.whitelist = ['different']; expect(() => opencodeModelConfig(f.ctx)).toThrow('不完整');
});
test('standalone profile tests and terminals use the same structured provider with declared credentials', () => {
  const f = fixture(), launch = LaunchSpecSchema.parse({ protocol: 'opencode', binaryPath: '/bin/opencode', model: 'gateway/m', opencodeProvider: { id: 'gateway', npm: '@ai-sdk/openai-compatible', models: { m: { name: 'M' } }, options: { baseURL: 'https://model.example/v1', headers: { 'x-client': 'crewstation' } }, credentials: { apiKey: 'KEY', headers: { Authorization: 'AUTH' } } } });
  const ctx: AgentSpawnContext = { ...f.ctx, businessNativeConfig: undefined, platformOpencodeModels: undefined, ...launchSpawnFields(launch), baseEnv: { KEY: 'pinned-secret', AUTH: 'Bearer pinned-auth' } };
  expect(opencodeModelConfig(ctx)).toMatchObject({ provider: { gateway: { models: { m: { name: 'M' } }, whitelist: ['m'], options: { apiKey: 'pinned-secret', headers: { 'x-client': 'crewstation', Authorization: 'Bearer pinned-auth' } } } } });
  expect(() => opencodeModelConfig({ ...ctx, baseEnv: {} })).toThrow('缺少');
  expect(() => opencodeModelConfig({ ...ctx, model: 'other/m' })).toThrow('没有档位模型');
  expect(opencodeModelConfig({ ...ctx, opencodeProvider: undefined })).toEqual({});
});
