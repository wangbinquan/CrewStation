import { expect, test } from 'bun:test';
import { BusinessConfigSchema } from '../../manifest/businessConfig';
import { BusinessNativeConfigSchema } from './nativeConfig';
import { BusinessMaterialRequestSchema, businessMaterialObjects } from './materials';
import { BUSINESS_NATIVE_MATERIAL_LIMITS, BusinessPluginFileSchema, businessMaterialAccounting, materialTreeIssue } from './materialFiles';
import { BUSINESS_EXECUTION_LIMITS } from './executionValues';
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
test('protocol-specific options are preserved or rejected instead of silently dropped', () => {
  const claude = { ...native(), protocol: 'claude-code', agent: { name: 'review', body: '', options: { tools: ['Read'], maxTurns: 3, permissionMode: 'dontAsk' } } };
  expect(BusinessNativeConfigSchema.safeParse(claude).success).toBe(true);
  expect(BusinessNativeConfigSchema.safeParse({ ...claude, mcp: [{ name: 'docs', type: 'remote', url: 'https://mcp.test', timeoutMs: 5000 }] }).success).toBe(false);
  for (const mcp of [{ name: 'docs', type: 'remote', url: 'https://token:private@mcp.test' }, { name: 'docs', type: 'local', command: ['tool'], env: { OPENCODE_CONFIG: '/escape' } }]) expect(BusinessNativeConfigSchema.safeParse({ ...native(), mcp: [mcp] }).success).toBe(false);
  expect(BusinessNativeConfigSchema.parse({ ...native(), plugins: [{ name: 'extension', entry: 'index.js', files: [file('index.js')], options: { nested: { value: 42 } } }] }).plugins[0]!.options).toEqual({ nested: { value: 42 } });
  expect(BusinessNativeConfigSchema.safeParse({ ...claude, plugins: [{ name: 'extension', entry: 'index.js', files: [file('index.js')], options: { ignored: true } }] }).success).toBe(false);
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


test('OpenCode native OAuth and MCP child env preserve exact values without opening reserved namespaces', () => {
  for (const oauth of [false, { clientId: 'client', clientSecret: 'secret', scope: 'read', redirectUri: 'http://127.0.0.1:19876/callback' }]) {
    const parsed = BusinessNativeConfigSchema.parse({ ...native(), mcp: [{ name: 'remote', type: 'remote', url: 'https://mcp.test', oauth }] });
    expect(parsed.mcp[0]).toMatchObject({ oauth });
  }
  const local = { name: 'local', type: 'local' as const, command: ['tool'], env: { apiKey: 'value', token: 'secret' } };
  expect(BusinessNativeConfigSchema.parse({ ...native(), mcp: [local] }).mcp[0]).toEqual(local);
  for (const name of ['opencode_config', 'LD_PRELOAD', 'DyLd_TEST', 'constructor']) {
    const env = { [name]: 'unsafe' };
    expect(BusinessNativeConfigSchema.safeParse({ ...native(), mcp: [{ ...local, env }] }).success).toBe(false);
  }
  for (const oauth of [{ unknown: true }, { redirectUri: 'file:///private' }]) expect(BusinessNativeConfigSchema.safeParse({ ...native(), mcp: [{ name: 'remote', type: 'remote', url: 'https://mcp.test', oauth }] }).success).toBe(false);
  const unsafe = JSON.parse('{"nested":{"__proto__":{"escape":true}}}');
  expect(BusinessNativeConfigSchema.safeParse({ ...native(), plugins: [{ name: 'extension', entry: 'index.js', files: [file('index.js')], options: unsafe }] }).success).toBe(false);
});


test('OpenCode native names retain AW identifiers through 128 characters', () => {
  const name = 'a'.repeat(128);
  expect(BusinessNativeConfigSchema.parse({ ...native(), agent: { name, body: '', options: {} }, mcp: [{ name, type: 'local', command: ['tool'] }], plugins: [{ name, entry: 'index.js', files: [file('index.js')] }] }).agent.name).toBe(name);
  expect(BusinessNativeConfigSchema.safeParse({ ...native(), agent: { name: name + 'a', body: '', options: {} } }).success).toBe(false);
  for (const name of ['crewstation-agent', 'cs-platform-task', '__proto__', '../escape']) expect(BusinessNativeConfigSchema.safeParse({ ...native(), agent: { name, body: '', options: {} } }).success).toBe(false);
});

// RFC-040: object-file descriptors used to count toward the 1 MiB inline envelope, capping plugin
// trees around 4–5k files although the stated native limit is 10,000 files.
test('a 10,000-file object plugin tree fits its descriptor budget while inline content keeps the 1 MiB envelope', () => {
  const files = Array.from({ length: 10_000 }, (_, i) => ({ kind: 'file' as const, path: `node_modules/package-${i}/lib/index.js`, object: { objectId: Bun.randomUUIDv7(), sha256: i.toString(16).padStart(64, '0'), size: 1 } }));
  const tree = { version: 1, protocol: 'opencode', agent: { name: 'root', body: '' }, plugins: [{ name: 'tree', entry: files[0]!.path, files }] };
  const material = { requestKey: 'tree', nativeConfig: tree }, accounting = businessMaterialAccounting(material);
  expect(accounting.descriptorBytes).toBeGreaterThan(BUSINESS_EXECUTION_LIMITS.materialBytes);
  expect(accounting.descriptorBytes).toBeLessThanOrEqual(BUSINESS_NATIVE_MATERIAL_LIMITS.descriptorBytes);
  expect(accounting.inlineBytes).toBeLessThan(4096);
  expect(BusinessMaterialRequestSchema.safeParse(material).success).toBe(true);
  expect(BusinessMaterialRequestSchema.safeParse({ ...material, systemPrompt: 'x'.repeat(BUSINESS_EXECUTION_LIMITS.materialBytes - 10) }).success).toBe(false);
  const long = files.map((file) => ({ ...file, path: `${file.path}/${'x'.repeat(400)}` }));
  expect(businessMaterialAccounting({ nativeConfig: { ...tree, plugins: [{ ...tree.plugins[0]!, files: long }] } }).descriptorBytes).toBeGreaterThan(BUSINESS_NATIVE_MATERIAL_LIMITS.descriptorBytes);
  expect(BusinessMaterialRequestSchema.safeParse({ ...material, nativeConfig: { ...tree, plugins: [{ name: 'tree', entry: long[0]!.path, files: long }] } }).success).toBe(false);
  // Unparsed bodies are measured the same way; malformed shapes count entirely as inline bytes.
  expect(businessMaterialAccounting({ skills: 'not-a-list', nativeConfig: { plugins: [null] } })).toEqual({ inlineBytes: Buffer.byteLength(JSON.stringify({ skills: 'not-a-list', nativeConfig: { plugins: [null] } })), descriptorBytes: 0 });
});
