import { afterEach, expect, test } from 'bun:test';
import { mkdtemp, mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { noopLogger } from '@crewstation/kernel';
import { prepareNativeTerminal } from '../drivers/nativeTerminal';
import { createFakeProcessHost } from './fakeProcessHost';

const cleanups: Array<() => Promise<void>> = [];
afterEach(async () => { for (const close of cleanups.splice(0)) await close(); });

async function fixture(version = '2.1.268', customEnv: Record<string, string> = {}) {
  const root = await mkdtemp(join(tmpdir(), 'cs-claude-observer-'));
  cleanups.push(() => rm(root, { recursive: true, force: true }));
  await mkdir(join(root, '.claude'));
  const existing = join(root, '.claude', 'settings.json');
  await writeFile(existing, JSON.stringify({ hooks: { Stop: [{ hooks: [{ type: 'command', command: 'user-hook' }] }] } }));
  const prepared = await prepareNativeTerminal({ launch: { protocol: 'claude-code', binaryPath: '/usr/local/bin/claude', extraArgs: [], isSandbox: false, model: 'anthropic/fixed-model' }, profileRevision: 1, permission: 'edit', agentId: 'native', compute: 'balanced', mcp: [] }, { cwd: root, runDir: join(root, 'run'), env: { HOME: root, ...customEnv }, host: createFakeProcessHost([{ stdout: [`${version} (Claude Code)`] }]), logger: noopLogger, nativeActivity: { endpoint: 'http://127.0.0.1:1234/activity/private', token: 'private' } });
  return { prepared, existing };
}

test('原生启动追加私有 hooks 与本机 telemetry，保留模型、工具和现有项目设置', async () => {
  const { prepared, existing } = await fixture();
  expect(prepared.activityUnavailable).toBeUndefined();
  expect(prepared.plan.cmd).toContain('fixed-model');
  const settingsPath = prepared.plan.cmd[prepared.plan.cmd.indexOf('--settings') + 1]!;
  const settings = JSON.parse(await readFile(settingsPath, 'utf8'));
  expect(settings.hooks.PermissionRequest[0].hooks[0].url).toBe('http://127.0.0.1:1234/activity/private/hooks');
  expect(settings.hooks.Stop).toBeUndefined();
  // 真实 CLI 静默忽略 HTTP SessionStart，必须使用 command 才能注册根会话。
  expect(settings.hooks.SessionStart[0].hooks[0].type).toBe('command');
  expect((await stat(settingsPath)).mode & 0o777).toBe(0o600);
  expect(await readFile(existing, 'utf8')).toContain('user-hook');
  expect(prepared.plan.env).toMatchObject({ OTEL_EXPORTER_OTLP_PROTOCOL: 'http/json', OTEL_METRIC_EXPORT_INTERVAL: '5000', OTEL_LOG_USER_PROMPTS: '0', OTEL_LOG_TOOL_CONTENT: '0' });
});

test('不支持的 CLI 和操作者已配置的 telemetry 只降级观察，保留 CLI 与原配置', async () => {
  const { prepared: unsupported } = await fixture('9.0.0');
  expect(unsupported.activityUnavailable).toBe('unsupported-version');
  expect(unsupported.plan.cmd).not.toContain('--settings');
  const { prepared: custom } = await fixture('2.1.268', { OTEL_EXPORTER_OTLP_ENDPOINT: 'https://company.example/telemetry' });
  expect(custom.activityUnavailable).toBe('source-error');
  expect(custom.plan.env.OTEL_EXPORTER_OTLP_ENDPOINT).toBe('https://company.example/telemetry');
  expect(custom.plan.cmd[0]).toBe('/usr/local/bin/claude');
});
