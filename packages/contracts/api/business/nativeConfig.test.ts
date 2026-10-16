import { expect, test } from 'bun:test';
import { BusinessConfigSchema } from '../../manifest/businessConfig';
import { BusinessNativeConfigSchema } from './nativeConfig';
import { BusinessMaterialRequestSchema, businessMaterialObjects } from './materials';
import { BusinessPluginFileSchema, materialTreeIssue } from './materialFiles';
import { SubmitBusinessSubtaskV3Schema } from './requests';
import { BusinessCommandSecretEnvironmentSchema } from './commandSecrets';

const native = () => ({ version: 1, protocol: 'opencode', agent: { name: 'review', body: 'Review source', options: { temperature: 0.2, variant: 'fast', permission: { bash: { '*': 'deny', 'git status': 'allow' } } } } });
const file = (path: string) => ({ kind: 'file' as const, path, content: 'module' });
const link = (path: string, target: string) => ({ kind: 'symlink' as const, path, target });

test('legacy material defaults and release defaults grant no native capability', () => {
  expect(BusinessMaterialRequestSchema.parse({ requestKey: 'old' })).toEqual({ requestKey: 'old', skills: [], mcp: [], env: {}, subagents: [] });
  expect(BusinessConfigSchema.parse({ nativeConfig: {} }).nativeConfig).toEqual({ agentDefinitions: false, inlineRemoteMcp: false, inlineLocalMcp: false, plugins: false });
  expect(BusinessNativeConfigSchema.parse(native())).toMatchObject({ subagents: [], mcp: [], plugins: [], agent: { options: { temperature: 0.2 } } });
});
test('protocol whitelists reject every platform override and preserve unknown field paths', () => {
  for (const field of ['model', 'provider', 'baseURL', 'apiKey', 'binary', 'launch', 'env', 'hooks', 'configDir', 'unknown']) {
    const result = BusinessNativeConfigSchema.safeParse({ ...native(), agent: { name: 'review', body: '', options: { [field]: 'private-value' } } });
    expect(result.success, field).toBe(false);
    if (!result.success) { expect(result.error.issues[0]!.path).toEqual(['agent', 'options', field]); expect(result.error.message).not.toContain('private-value'); }
  }
  expect(BusinessNativeConfigSchema.safeParse({ ...native(), protocol: 'claude-code' }).success).toBe(false);
  expect(BusinessNativeConfigSchema.safeParse({ ...native(), agent: { name: 'crewstation', body: '', options: {} } }).success).toBe(false);
  expect(BusinessNativeConfigSchema.safeParse({ ...native(), subagents: [{ name: 'review', body: '', options: {} }] }).success).toBe(false);
  const unsafe = JSON.parse('{"version":1,"protocol":"opencode","agent":{"name":"review","body":"","options":{"permission":{"__proto__":"allow"}}}}');
  expect(BusinessNativeConfigSchema.safeParse(unsafe).success).toBe(false);
});
test('Claude rejects unsupported per-server timeout and plugins reject unsupported options instead of dropping them', () => {
  const claude = { ...native(), protocol: 'claude-code', agent: { name: 'review', body: '', options: { tools: ['Read'], maxTurns: 3, permissionMode: 'dontAsk' } } };
  expect(BusinessNativeConfigSchema.safeParse(claude).success).toBe(true);
  expect(BusinessNativeConfigSchema.safeParse({ ...claude, mcp: [{ name: 'docs', type: 'remote', url: 'https://mcp.test', timeoutMs: 5000 }] }).success).toBe(false);
  for (const mcp of [{ name: 'docs', type: 'remote', url: 'https://token:private@mcp.test' }, { name: 'docs', type: 'local', command: ['tool'], env: { OPENCODE_CONFIG: '/escape' } }]) expect(BusinessNativeConfigSchema.safeParse({ ...native(), mcp: [mcp] }).success).toBe(false);
  expect(BusinessNativeConfigSchema.safeParse({ ...native(), plugins: [{ name: 'extension', entry: 'index.js', files: [file('index.js')], options: { ignored: true } }] }).success).toBe(false);
});
test('plugin trees retain executable files and dependency links while refusing every path escape', () => {
  const files = [file('packages/tool/index.js'), { ...file('node_modules/dependency/bin.js'), mode: 0o755 }, link('packages/tool/dependency', '../../node_modules/dependency')];
  expect(materialTreeIssue(files, 'packages/tool')).toBeUndefined();
  expect(BusinessPluginFileSchema.parse(files[1]).kind).toBe('file');
  for (const invalid of [
    [file('index.js'), file('index.js')], [file('a'), file('a/b')], [link('a', 'target'), file('a/b'), file('target')],
    [link('a', '../escape')], [link('a', 'missing')], [link('a', 'b'), link('b', 'a')], [link('a', 'a')], [file('cafe\u0301')],
  ]) expect(materialTreeIssue(invalid)).toBeDefined();
  expect(materialTreeIssue([file('index.js')], 'missing')).toBe('missing-entry');
  for (const path of ['/escape', '../escape', 'a/./b', 'a//b', 'a\\b', 'a/../b']) expect(BusinessPluginFileSchema.safeParse(file(path)).success).toBe(false);
  for (const mode of [-1, 0o1000, 0o4755, 1.5]) expect(BusinessPluginFileSchema.safeParse({ ...file('entry'), mode }).success).toBe(false);
});
test('object file metadata is immutable and cannot mix with inline content or exceed budgets', () => {
  const object = { objectId: Bun.randomUUIDv7(), sha256: 'a'.repeat(64), size: 2 * 1024 * 1024 };
  const material = BusinessMaterialRequestSchema.parse({ requestKey: 'objects', skills: [{ path: 'review/data.bin', object }] });
  expect(businessMaterialObjects(material)).toEqual([object]);
  expect(BusinessMaterialRequestSchema.safeParse({ requestKey: 'bad', skills: [{ path: 'review/data', content: '', object }] }).success).toBe(false);
  expect(BusinessMaterialRequestSchema.safeParse({ requestKey: 'bad', skills: [{ path: 'review/data' }] }).success).toBe(false);
  expect(BusinessMaterialRequestSchema.safeParse({ requestKey: 'bad', skills: [{ path: 'review/a', object }, { path: 'review/b', object: { ...object, size: 1 } }] }).success).toBe(false);
  expect(BusinessMaterialRequestSchema.safeParse({ requestKey: 'bad', skills: Array.from({ length: 129 }, (_, i) => ({ path: `review/${i}`, content: '' })) }).success).toBe(false);
  expect(BusinessMaterialRequestSchema.safeParse({ requestKey: 'bad', skills: [{ path: 'review/a', object: { ...object, size: 1024 ** 3 } }, { path: 'review/b', content: 'x' }] }).success).toBe(false);
});
test('command Secret requests use references while Runner stamps require the exact same unique definitions', () => {
  const id = Bun.randomUUIDv7(), input = { kind: 'command', name: 'git', requestKey: 'git', argv: ['git', 'fetch'], env: { GIT_TOKEN: { secret: { configDefinitionId: id } } } };
  expect(SubmitBusinessSubtaskV3Schema.parse(input)).toMatchObject(input);
  expect(SubmitBusinessSubtaskV3Schema.safeParse({ ...input, env: { HOME: 'escape' } }).success).toBe(false);
  const stamp = { version: 1, nonce: 'a'.repeat(64), references: { GIT_TOKEN: id }, versions: [{ definitionId: id, itemId: Bun.randomUUIDv7(), version: 1 }] };
  expect(BusinessCommandSecretEnvironmentSchema.safeParse(stamp).success).toBe(true);
  expect(BusinessCommandSecretEnvironmentSchema.safeParse({ ...stamp, versions: [] }).success).toBe(false);
  expect(BusinessCommandSecretEnvironmentSchema.safeParse({ ...stamp, versions: [...stamp.versions, ...stamp.versions] }).success).toBe(false);
});
