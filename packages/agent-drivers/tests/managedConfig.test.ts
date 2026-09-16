import { afterEach, expect, test } from 'bun:test';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { noopLogger } from '@crewstation/kernel';
import { mergeClaudeSettings } from '../drivers/claudeCode/managedSettings';
import { prepareNativeTerminal } from '../drivers/nativeTerminal';
import { mergeOpencodeConfig } from '../drivers/opencode/managedConfig';
import { createFakeProcessHost } from './fakeProcessHost';

const cleanups: Array<() => Promise<void>> = [];
afterEach(async () => { for (const clean of cleanups.splice(0)) await clean(); });

test('Claude settings 合成：管理员内容为底，平台观测 hooks 按事件追加，其余键保留', () => {
  const admin = { env: { ANTHROPIC_BASE_URL: 'https://gw' }, permissions: { allow: ['Read'] }, hooks: { PreToolUse: [{ hooks: [{ type: 'command', command: 'admin-hook' }] }] } };
  const merged = mergeClaudeSettings(admin, { PreToolUse: [{ hooks: [{ type: 'http', url: 'http://127.0.0.1:1/hooks' }] }], SessionStart: [{ hooks: [{ type: 'command', command: 'session' }] }] });
  expect(merged.env).toEqual({ ANTHROPIC_BASE_URL: 'https://gw' });
  expect(merged.permissions).toEqual({ allow: ['Read'] });
  const hooks = merged.hooks as Record<string, Array<{ hooks: Array<{ command?: string; url?: string }> }>>;
  expect(hooks.PreToolUse!.map((g) => g.hooks[0]!.command ?? g.hooks[0]!.url)).toEqual(['admin-hook', 'http://127.0.0.1:1/hooks']);
  expect(hooks.SessionStart).toHaveLength(1);
  expect(mergeClaudeSettings(undefined, undefined)).toEqual({});
});

test('OpenCode 配置合成：保留管理员 provider options／baseURL，只叠加平台的 whitelist、模型范围与 plugin', () => {
  const admin = { $schema: 'x', provider: { anthropic: { options: { baseURL: 'https://gw/v1', apiKey: 'secret' }, models: { 'claude-x': { name: 'X' } } } }, plugin: ['file:///admin-plugin.mjs'], theme: 'dark' };
  const platform = { model: 'anthropic/claude-x', small_model: 'anthropic/claude-x', enabled_providers: ['anthropic'], provider: { anthropic: { whitelist: ['claude-x'] } }, agent: { crewstation: { model: 'anthropic/claude-x' } }, plugin: ['file:///observer.mjs'] };
  const merged = mergeOpencodeConfig(admin, platform) as Record<string, unknown>;
  expect(merged.provider).toEqual({ anthropic: { options: { baseURL: 'https://gw/v1', apiKey: 'secret' }, models: { 'claude-x': { name: 'X' } }, whitelist: ['claude-x'] } });
  expect(merged.plugin).toEqual(['file:///admin-plugin.mjs', 'file:///observer.mjs']);
  expect(merged).toMatchObject({ theme: 'dark', model: 'anthropic/claude-x', enabled_providers: ['anthropic'], agent: { crewstation: { model: 'anthropic/claude-x' } } });
});

async function managedFixture(driver: 'claude-code' | 'opencode', file: string, content: string) {
  const root = await mkdtemp(join(tmpdir(), 'cs-managed-plan-'));
  cleanups.push(() => rm(root, { recursive: true, force: true }));
  const home = join(root, 'home');
  await mkdir(join(home, driver === 'claude-code' ? '.claude' : '.opencode'), { recursive: true });
  const path = join(home, file);
  await writeFile(path, content);
  const host = createFakeProcessHost([{ stdout: [driver === 'claude-code' ? '2.1.268 (Claude Code)' : '1.18.29'] }]);
  const prepared = await prepareNativeTerminal({ driver, permission: 'edit', agentId: 'managed', compute: 'managed', model: 'anthropic/model-name', mcp: [{ name: 'platform', url: 'http://mcp.example/mcp', headers: { authorization: 'mcp-token' } }], runtime: { configId: 'arc_' + 'c'.repeat(32), revision: 4 } },
    { cwd: root, runDir: join(root, 'run'), env: { HOME: home, API_KEY: 'k' }, host, logger: noopLogger, managed: { home, runDir: join(root, 'run'), configFile: { kind: driver === 'claude-code' ? 'claude-settings' : 'opencode-config', path } },
      nativeActivity: driver === 'claude-code' ? { endpoint: 'http://127.0.0.1:1234/activity/private', token: 'private' } : undefined });
  return { root, home, prepared };
}

test('Claude 托管原生启动：CLAUDE_CONFIG_DIR 指向私有 .claude，管理员 settings 与观测 hooks 合成为唯一 --settings', async () => {
  const { home, prepared } = await managedFixture('claude-code', '.claude/settings.json', '// admin\n{ "env": { "ANTHROPIC_BASE_URL": "https://gw" }, "hooks": { "Stop": [{ "hooks": [{ "type": "command", "command": "admin-stop" }] }] } }');
  expect(prepared.plan.env.CLAUDE_CONFIG_DIR).toBe(join(home, '.claude'));
  const settingsFlags = prepared.plan.cmd.filter((arg) => arg === '--settings');
  expect(settingsFlags).toHaveLength(1);
  const settings = JSON.parse(await readFile(prepared.plan.cmd[prepared.plan.cmd.indexOf('--settings') + 1]!, 'utf8'));
  expect(settings.env).toEqual({ ANTHROPIC_BASE_URL: 'https://gw' });
  expect(settings.hooks.Stop[0].hooks[0].command).toBe('admin-stop');
  expect(settings.hooks.PermissionRequest[0].hooks[0].url).toBe('http://127.0.0.1:1234/activity/private/hooks');
  expect(prepared.activityUnavailable).toBeUndefined();
});

test('OpenCode 托管原生启动：OPENCODE_CONFIG 指向合成文件，管理员 provider options 保留且受控模型范围生效', async () => {
  const { prepared } = await managedFixture('opencode', '.opencode/opencode.json', JSON.stringify({ provider: { anthropic: { options: { baseURL: 'https://gw/v1' } } } }));
  const file = prepared.plan.env.OPENCODE_CONFIG!;
  const config = JSON.parse(await readFile(file, 'utf8'));
  expect(config.provider.anthropic).toEqual({ options: { baseURL: 'https://gw/v1' }, whitelist: ['model-name'] });
  expect(config).toMatchObject({ model: 'anthropic/model-name', enabled_providers: ['anthropic'] });
  expect(config.mcp.platform.headers.authorization).toBe('mcp-token');
  // 平台叠加层仍在环境里，CLI 最后合并它。
  expect(JSON.parse(prepared.plan.env.OPENCODE_CONFIG_CONTENT!)).toMatchObject({ model: 'anthropic/model-name' });
});

test('管理员配置文件坏了：驱动报 cli_config_invalid 而不是静默改用默认配置', async () => {
  const root = await mkdtemp(join(tmpdir(), 'cs-managed-bad-'));
  cleanups.push(() => rm(root, { recursive: true, force: true }));
  const path = join(root, 'settings.json');
  await writeFile(path, '{ not json');
  const error = await prepareNativeTerminal({ driver: 'claude-code', permission: 'edit', agentId: 'bad', compute: 'managed', model: 'anthropic/m', mcp: [] }, { cwd: root, runDir: join(root, 'run'), env: {}, host: createFakeProcessHost([]), logger: noopLogger, managed: { home: root, runDir: join(root, 'run'), configFile: { kind: 'claude-settings', path } } }).catch((e: unknown) => e);
  expect(error).toMatchObject({ kind: 'validation', details: { code: 'cli_config_invalid' } });
});
