import { afterEach, expect, test } from 'bun:test';
import { mkdtemp, mkdir, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { BusinessNativeConfigSchema, LaunchSpecSchema } from '@crewstation/contracts';
import { noopLogger } from '@crewstation/kernel';
import { createFakeProcessHost } from './fakeProcessHost';
import { opencodeAdapter } from '../drivers/opencode/driver';
import { claudeCodeAdapter } from '../drivers/claudeCode/driver';
import { stageNativeMaterials } from '../injection/nativeMaterials';
import { materializeBusinessFiles } from '../injection/materialFiles';
import { claudeNativeAgents } from '../injection/nativeMaterials';

const cleanup: Array<() => unknown> = [];
afterEach(async () => { for (const fn of cleanup.splice(0).reverse()) await fn(); });
async function root() { const path = await mkdtemp(join(tmpdir(), 'native-material-test-')); cleanup.push(() => rm(path, { recursive: true, force: true })); return path; }
for (const protocol of ['opencode', 'claude-code'] as const) test(`${protocol} compiles root, subagent, MCP and complete plugin tree without changing the platform model`, async () => {
  const path = await root(), home = join(path, 'home'); await mkdir(home);
  const host = createFakeProcessHost([{ stdout: ['1.18.29'] }]);
  const native = BusinessNativeConfigSchema.parse({ version: 1, protocol, agent: { name: 'review', body: 'root instructions', options: protocol === 'opencode' ? { temperature: 0.2, permission: { bash: 'deny' } } : { tools: ['Read'], disallowedTools: ['Bash'], permissionMode: 'dontAsk', maxTurns: 5 } }, subagents: [{ name: 'helper', body: 'helper instructions', options: { description: 'Inspect files' } }], mcp: [{ name: 'local-tool', type: 'local', command: ['node', 'tool.js'], env: { APP_TOKEN: 'private-mcp' } }], plugins: [{ name: 'extension', entry: protocol === 'opencode' ? 'package/index.js' : 'package', files: [
    { kind: 'file', path: 'package/index.js', content: 'export default {}', mode: 0o755 },
    { kind: 'file', path: 'package/.claude-plugin/plugin.json', content: '{"name":"extension","version":"1.0.0"}' },
    { kind: 'file', path: 'node_modules/dependency/index.js', content: 'export default 42' },
    { kind: 'symlink', path: 'package/dependency', target: '../node_modules/dependency' },
  ] }] });
  const adapter = protocol === 'opencode' ? opencodeAdapter() : claudeCodeAdapter();
  const prepared = await adapter.prepare({ agentId: crypto.randomUUID(), compute: 'profile', profileRevision: 1, launch: LaunchSpecSchema.parse({ protocol, binaryPath: `/bin/agent-${crypto.randomUUID()}`, model: 'provider/platform-model' }), mode: 'oneshot', permission: 'full', mcp: [{ name: 'crewstation-api', url: 'http://platform.test/mcp', headers: { authorization: 'platform-secret' } }], businessNativeConfig: native }, { cwd: path, runDir: join(path, 'run'), managed: { home, runDir: join(path, 'run') }, env: { HOME: home }, host, logger: noopLogger });
  cleanup.push(prepared.dispose);
  const plan = prepared.plan({ prompt: 'review', resident: false });
  expect(plan.cmd.join(' ')).not.toContain('private-mcp'); expect(plan.cmd.join(' ')).not.toContain('platform-secret');
  if (protocol === 'opencode') {
    const config = JSON.parse(plan.env.OPENCODE_CONFIG_CONTENT!);
    expect(plan.cmd.slice(plan.cmd.indexOf('--agent'), plan.cmd.indexOf('--agent') + 2)).toEqual(['--agent', 'review']);
    expect(config.agent.review).toMatchObject({ model: 'provider/platform-model', temperature: 0.2, permission: { bash: 'deny' } });
    expect(config.agent.helper.model).toBe('provider/platform-model');
    const promptPath = String(config.agent.review.prompt).slice(6, -1); expect(await readFile(promptPath, 'utf8')).toBe('root instructions');
    expect(config.mcp['local-tool']).toMatchObject({ type: 'local', command: ['node', 'tool.js'], environment: { APP_TOKEN: 'private-mcp' } });
    const entry = new URL(config.plugin[0]); expect((await stat(entry)).mode & 0o777).toBe(0o755);
    expect(await readFile(new URL('./dependency/index.js', entry), 'utf8')).toBe('export default 42');
  } else {
    const agents = JSON.parse(plan.cmd[plan.cmd.indexOf('--agents') + 1]!);
    expect(agents.review).toMatchObject({ model: 'platform-model', tools: ['Read'], prompt: 'root instructions' });
    expect(agents.helper.model).toBe('platform-model');
    expect(plan.cmd[plan.cmd.indexOf('--max-turns') + 1]).toBe('5');
    const mcp = JSON.parse(await readFile(plan.cmd[plan.cmd.indexOf('--mcp-config') + 1]!, 'utf8'));
    expect(mcp.mcpServers['local-tool']).toMatchObject({ command: 'node', args: ['tool.js'], env: { APP_TOKEN: 'private-mcp' } });
    expect(await readFile(join(plan.cmd[plan.cmd.indexOf('--plugin-dir') + 1]!, 'dependency/index.js'), 'utf8')).toBe('export default 42');
  }
  prepared.dispose(); await expect(stat(join(path, 'run'))).rejects.toThrow();
});
test('binary object bytes are streamed, hashed and atomically published with the requested mode', async () => {
  const path = await root(), bytes = new Uint8Array([0, 255, 1, 254, 128, 10]); let authorized = false;
  const server = Bun.serve({ port: 0, hostname: '127.0.0.1', fetch: (request) => { authorized = request.headers.get('authorization') === 'Bearer scoped-secret'; return new Response(bytes); } }); cleanup.push(() => server.stop(true));
  const object = { objectId: Bun.randomUUIDv7(), sha256: new Bun.CryptoHasher('sha256').update(bytes).digest('hex'), size: bytes.length };
  const grant = { object, url: `http://127.0.0.1:${server.port}/object`, token: 'scoped-secret', expiresAt: new Date(Date.now() + 60_000).toISOString() };
  await materializeBusinessFiles(join(path, 'tree'), [{ kind: 'file', path: 'binary', object, mode: 0o750 }], [grant], createFakeProcessHost([]));
  expect(authorized).toBe(true); expect(new Uint8Array(await readFile(join(path, 'tree/binary')))).toEqual(bytes); expect((await stat(join(path, 'tree/binary'))).mode & 0o777).toBe(0o750);
  for (const [name, changed] of [['digest', { ...object, sha256: 'a'.repeat(64) }], ['size', { ...object, size: 1 }]] as const) {
    await expect(materializeBusinessFiles(join(path, name), [{ kind: 'file', path: 'binary', object: changed }], [{ ...grant, object: changed }], createFakeProcessHost([]))).rejects.toThrow('完整性');
    await expect(stat(join(path, name, 'binary'))).rejects.toThrow();
  }
  await expect(materializeBusinessFiles(join(path, 'expired'), [{ kind: 'file', path: 'binary', object }], [{ ...grant, expiresAt: '2000-01-01T00:00:00.000Z' }], createFakeProcessHost([]))).rejects.toThrow('过期');
});
test('missing grants, unsafe links and unsupported huge Claude definitions fail before any CLI launch', async () => {
  const path = await root(), host = createFakeProcessHost([]);
  const bad = { version: 1, protocol: 'opencode', agent: { name: 'review', body: '', options: {} }, subagents: [], mcp: [], plugins: [{ name: 'extension', entry: 'entry', files: [{ path: 'entry', kind: 'symlink', target: '/work/private' }] }] };
  await expect(stageNativeMaterials(bad as never, path, host, [])).rejects.toThrow();
  const object = { objectId: Bun.randomUUIDv7(), sha256: 'a'.repeat(64), size: 1 };
  await expect(materializeBusinessFiles(join(path, 'no-grant'), [{ kind: 'file', path: 'entry', object }], [], host)).rejects.toThrow('授权');
  const native = BusinessNativeConfigSchema.parse({ version: 1, protocol: 'claude-code', agent: { name: 'review', body: 'x'.repeat(130_000), options: {} } });
  expect(() => claudeNativeAgents(native)).toThrow('预算'); expect(host.spawns).toHaveLength(0);
});


test('managed Agent and MCP collisions fail before material writes or native CLI launch', async () => {
  for (const kind of ['agent', 'mcp'] as const) {
    const path = await root(), admin = join(path, 'admin.json'), host = createFakeProcessHost([]);
    await writeFile(admin, JSON.stringify({ [kind]: { reviewer: kind === 'agent' ? { prompt: 'admin' } : { type: 'local', command: ['tool'] } } }));
    const native = BusinessNativeConfigSchema.parse({ version: 1, protocol: 'opencode', agent: { name: 'reviewer', body: 'business' }, ...(kind === 'mcp' ? { mcp: [{ name: 'reviewer', type: 'local', command: ['node'] }] } : {}) });
    await expect(opencodeAdapter().prepare({ agentId: 'agent', compute: 'profile', profileRevision: 1, launch: LaunchSpecSchema.parse({ protocol: 'opencode', binaryPath: '/bin/opencode' }), mode: 'oneshot', permission: 'full', mcp: [], businessNativeConfig: native }, { cwd: path, env: {}, runDir: join(path, 'run'), managed: { home: path, runDir: join(path, 'run'), configFile: { kind: 'opencode-config', path: admin } }, host, logger: noopLogger })).rejects.toThrow('重名');
    expect(host.spawns).toHaveLength(0); await expect(stat(join(path, 'run'))).rejects.toThrow();
    expect(JSON.parse(await readFile(admin, 'utf8'))[kind].reviewer).toBeDefined();
  }
});
test('cancelling an in-flight object stream removes the private partial tree', async () => {
  const path = await root(), entered = Promise.withResolvers<void>(), abort = new AbortController();
  const server = Bun.serve({ hostname: '127.0.0.1', port: 0, fetch: () => { entered.resolve(); return new Response(new ReadableStream({ start(controller) { controller.enqueue(new Uint8Array([1])); } })); } }); cleanup.push(() => server.stop(true));
  const object = { objectId: Bun.randomUUIDv7(), sha256: 'a'.repeat(64), size: 100 };
  const native = BusinessNativeConfigSchema.parse({ version: 1, protocol: 'opencode', agent: { name: 'review', body: '' }, plugins: [{ name: 'plugin', entry: 'entry.mjs', files: [{ path: 'entry.mjs', kind: 'file', object }] }] });
  const staging = stageNativeMaterials(native, path, createFakeProcessHost([]), [{ object, url: `http://127.0.0.1:${server.port}/object`, token: 'private', expiresAt: new Date(Date.now() + 60_000).toISOString() }], abort.signal);
  // Attach a rejection handler immediately, but do not invoke Bun's async matcher before triggering cancellation.
  const settled = staging.then(() => undefined, (error: unknown) => error);
  await entered.promise; abort.abort();
  expect(await settled).toMatchObject({ details: { code: 'material_download_cancelled' } });
  expect(await readdir(path)).toEqual([]);
});
