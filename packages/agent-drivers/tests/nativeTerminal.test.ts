import { afterEach, expect, test } from 'bun:test';
import { mkdtemp, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { noopLogger } from '@crewstation/kernel';
import type { NativeTerminalSpec } from '../contract/nativeTerminal';
import { prepareNativeTerminal } from '../drivers/nativeTerminal';
import { createFakeProcessHost } from './fakeProcessHost';

const cleanup: Array<() => Promise<unknown>> = [];
afterEach(async () => { for (const clean of cleanup.splice(0)) await clean(); });

async function fixture(driver: NativeTerminalSpec['driver'], permission: NativeTerminalSpec['permission'] = 'edit') {
  const root = await mkdtemp(join(tmpdir(), 'cs-native-plan-'));
  cleanup.push(() => rm(root, { recursive: true, force: true }));
  const host = createFakeProcessHost([]);
  const spec: NativeTerminalSpec = { driver, permission, agentId: 'agent-native', compute: 'balanced', model: 'anthropic/model-name', systemPrompt: 'Shared worktree instructions', mcp: [{ name: 'platform', url: 'http://mcp.example/mcp', headers: { authorization: 'private-mcp-token' } }] };
  const prepared = await prepareNativeTerminal(spec, { cwd: root, runDir: join(root, 'run'), env: { MODEL_KEY: 'private-model-key' }, host, logger: noopLogger, gitUserName: 'Developer', gitUserEmail: 'dev@example.invalid' });
  return { root, host, prepared };
}

test('Claude 原生计划无需初始 prompt，独立 session id，权限／MCP／Git 身份保留且不是 JSON 模式', async () => {
  const { host, prepared } = await fixture('claude-code');
  expect(prepared.plan.cmd[0]).toBe('claude');
  expect(prepared.plan.cmd).not.toContain('-p');
  expect(prepared.plan.cmd).not.toContain('--input-format');
  expect(prepared.plan.cmd).not.toContain('--output-format');
  expect(prepared.plan.cmd).not.toContain('--continue');
  expect(prepared.plan.cmd).toContain('model-name');
  const toolNames = prepared.plan.cmd[prepared.plan.cmd.indexOf('--tools') + 1]!.split(',');
  expect(toolNames).toContain('Edit');
  expect(toolNames).toContain('AskUserQuestion');
  expect(toolNames).not.toContain('Bash');
  expect(prepared.nativeSessionId).toMatch(/^[0-9a-f-]{36}$/);
  expect((await fixture('claude-code')).prepared.nativeSessionId).not.toBe(prepared.nativeSessionId);
  const mcpPath = prepared.plan.cmd[prepared.plan.cmd.indexOf('--mcp-config') + 1]!;
  expect(await Bun.file(mcpPath).json()).toMatchObject({ mcpServers: { platform: { headers: { authorization: 'private-mcp-token' } } } });
  expect((await stat(mcpPath)).mode & 0o777).toBe(0o600);
  expect(host.chownedPaths).toContain(mcpPath);
  expect(prepared.plan.cmd.join(' ')).not.toContain('private-');
  expect(prepared.plan.env).toMatchObject({ MODEL_KEY: 'private-model-key', GIT_AUTHOR_NAME: 'Developer', GIT_COMMITTER_EMAIL: 'dev@example.invalid' });
  prepared.dispose();
  expect(await Bun.file(mcpPath).exists()).toBe(false);
});

test('OpenCode 原生计划使用 TUI、固定算力模型与会话独立配置，不继承最近会话', async () => {
  const { prepared } = await fixture('opencode', 'read-only');
  expect(prepared.plan.cmd[0]).toBe('opencode');
  for (const flag of ['run', '--format', '--auto', '--continue', '--session']) expect(prepared.plan.cmd).not.toContain(flag);
  expect(prepared.plan.cmd).toContain('anthropic/model-name');
  const config = JSON.parse(prepared.plan.env.OPENCODE_CONFIG_CONTENT!);
  // 真实 1.18.29 在缺少所选模型时回退到 Big Pickle；平台模型范围必须一并固定。
  expect(config).toMatchObject({ model: 'anthropic/model-name', small_model: 'anthropic/model-name', enabled_providers: ['anthropic'], provider: { anthropic: { whitelist: ['model-name'] } } });
  const name = prepared.plan.cmd[prepared.plan.cmd.indexOf('--agent') + 1]!;
  expect(config.agent[name]).toMatchObject({ model: 'anthropic/model-name', permission: { read: 'allow', edit: 'deny', bash: 'deny' } });
  expect(config.mcp.platform).toMatchObject({ headers: { authorization: 'private-mcp-token' } });
  expect((await stat(join(prepared.plan.env.OPENCODE_CONFIG_DIR!, 'skills'))).isDirectory()).toBe(true);
  expect(prepared.plan.cmd.join(' ')).not.toContain('private-');
});
