import { afterEach, expect, test } from 'bun:test';
import { mkdtemp, mkdir, readFile, readlink, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { noopLogger } from '@crewstation/kernel';
import { prepareNativeTerminal } from '../drivers/nativeTerminal';
import { resetOpencodeProbes } from '../drivers/opencode/probe';
import { resetOpencodeBinaryVersions } from '../drivers/opencode/versionRegistry';
import { seedOpencodePluginDependencies } from '../process/opencodePluginDependencies';
import { createFakeProcessHost } from './fakeProcessHost';

const cleanups: Array<() => Promise<void>> = [];
afterEach(async () => { for (const close of cleanups.splice(0)) await close(); resetOpencodeProbes(); resetOpencodeBinaryVersions(); });

async function fixture(version = '1.18.29') {
  resetOpencodeProbes(); resetOpencodeBinaryVersions();
  const root = await mkdtemp(join(tmpdir(), 'cs-observer-setup-'));
  cleanups.push(() => rm(root, { recursive: true, force: true }));
  const host = createFakeProcessHost([{ stdout: [version] }]);
  const deps = join(root, 'deps'); await mkdir(join(deps, 'node_modules'), { recursive: true });
  await writeFile(join(deps, 'package.json'), JSON.stringify({ dependencies: { '@opencode-ai/plugin': '1.18.29' } }));
  await writeFile(join(deps, 'package-lock.json'), JSON.stringify({ lockfileVersion: 3, packages: { '': { dependencies: { '@opencode-ai/plugin': '1.18.29' } } } }));
  const prepare = () => prepareNativeTerminal({ launch: { protocol: 'opencode', binaryPath: '/usr/local/bin/opencode', extraArgs: [], isSandbox: false, model: 'anthropic/fixed-model' }, profileRevision: 1, permission: 'edit', agentId: 'native', compute: 'balanced', mcp: [] }, { cwd: root, runDir: join(root, 'run'), env: { HOME: root }, host, logger: noopLogger, nativeActivity: { endpoint: 'http://127.0.0.1:1234/activity', token: 'private-observer-token', opencodeDependencies: deps } });
  return { root, host, deps, prepare };
}

test('固定版本生成私有插件并预装 npm lock；不改变平台的模型与操作权限', async () => {
  const f = await fixture(); const prepared = await f.prepare();
  const config = JSON.parse(prepared.plan.env.OPENCODE_CONFIG_CONTENT!);
  expect(prepared.activityUnavailable).toBeUndefined();
  expect(config.model).toBe('anthropic/fixed-model');
  expect(config.agent.crewstation.permission.bash).toBe('deny');
  const plugin = config.plugin[0].slice('file://'.length);
  expect((await stat(plugin)).mode & 0o777).toBe(0o600);
  expect(await readFile(plugin, 'utf8')).toContain('private-observer-token');
  expect(prepared.plan.cmd.join(' ')).not.toContain('private-observer-token');
  const globalConfig = join(f.root, '.config', 'opencode');
  expect(await readlink(join(globalConfig, 'node_modules'))).toBe(join(f.deps, 'node_modules'));
  expect(f.host.chownedPaths).toContain(join(f.root, '.config'));
  expect(await Bun.file(join(globalConfig, 'package-lock.json')).json()).toHaveProperty('lockfileVersion', 3);
});

test('其他版本或 SDK 缺失仅降级状态源，原生 CLI 的运行计划仍保留', async () => {
  const unsupported = await (await fixture('9.0.0')).prepare();
  expect(unsupported.activityUnavailable).toBe('unsupported-version');
  expect(JSON.parse(unsupported.plan.env.OPENCODE_CONFIG_CONTENT!).plugin).toBeUndefined();
  const f = await fixture(); await rm(f.deps, { recursive: true });
  const unavailable = await f.prepare();
  expect(unavailable.activityUnavailable).toBe('source-error');
  expect(unavailable.plan.cmd[0]).toBe('/usr/local/bin/opencode');
});

test('已有用户依赖完整保留，多 CLI 同时准备不会互相覆盖全局目录', async () => {
  const f = await fixture();
  const target = join(f.root, 'existing'); await mkdir(target);
  await writeFile(join(target, 'package.json'), 'user-owned-dependencies');
  await seedOpencodePluginDependencies(f.deps, target, f.host);
  expect(await readFile(join(target, 'package.json'), 'utf8')).toBe('user-owned-dependencies');
  expect(await Bun.file(join(target, 'package-lock.json')).exists()).toBe(false);
  const fresh = join(f.root, 'fresh');
  await Promise.all([seedOpencodePluginDependencies(f.deps, fresh, f.host), seedOpencodePluginDependencies(f.deps, fresh, f.host)]);
  expect(await readlink(join(fresh, 'node_modules'))).toBe(join(f.deps, 'node_modules'));
});
