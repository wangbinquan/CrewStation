import { afterEach, describe, expect, test } from 'bun:test';
import { IDENTITY_HEADERS } from '@crewstation/contracts';
import { echoDriverFactory } from './echoAgentDriver';
import type { FakeSession } from './fakeSession';
import type { CommandFailure } from './fakeSession';
import { startFakeSession } from './fakeSession';
import { launchSpec, material, profileFields } from './profileFixtures';
import type { TestRunner } from './testRunner';
import { startTestRunner } from './testRunner';

const cleanups: Array<() => Promise<void> | void> = [];
afterEach(async () => { for (const cleanup of cleanups.splice(0).reverse()) await cleanup(); });

async function boot(): Promise<{ session: FakeSession; tr: TestRunner; drivers: ReturnType<typeof echoDriverFactory> }> {
  const session = startFakeSession();
  cleanups.push(() => session.stop());
  const drivers = echoDriverFactory();
  const tr = await startTestRunner(session.url, {}, { drivers });
  cleanups.push(() => tr.dispose());
  await tr.runner.whenConnected();
  return { session, tr, drivers };
}

const profile = (steps: Parameters<typeof material>[0]) => material(steps, { profile: '01a0bf5d-8f4b-7f24-84a5-e66d1728cc0f', revision: 2, vars: { GATEWAY: 'https://gw' }, secrets: { API_KEY: 'sk-managed' } });
const mcp = [{ name: 'operations', url: 'http://mcp-operations.svc/mcp', headers: { [IDENTITY_HEADERS.devSessionToken]: 'dev-session-token-managed' } }];

describe('启动前 Hook 经真实 Runner 协议（RFC-004；RFC-006 起每次启动都经它）', () => {
  test('hello 宣告解释器；startAgent 先跑 Hook 再起 Agent，档位的变量、凭据与脚本输出进 CLI 环境，HOME 是私有家目录', async () => {
    const { session, drivers } = await boot();
    const hello = await session.waitFor(() => session.hellos[0]);
    expect(hello.capabilities.interpreters?.map((i) => i.language)).toContain('shell');
    await session.call({ id: 'm1', type: 'startAgent', agentId: 'managed-1', ...profileFields('managed-1', { compute: '01a0bf5d-8f4b-7f24-84a5-e66d1728cc0f', profileRevision: 2, launch: launchSpec('opencode', { model: 'anthropic/echo' }), mcp,
      beforeStart: profile([{ kind: 'script', stepId: '01a0bf5d-8f4b-7ac6-80eb-2eff6f51a8e3', name: '记录 HOME', language: 'shell', argv: [], timeoutMs: 10000, source: 'printf \'{"HOME_SEEN":"%s","MCP_SEEN":"%s"}\' "$HOME" "${CS_MCP_OPERATIONS_URL:-absent}" > "$CS_HOOK_ENV_OUT"' }]) }), mode: 'oneshot', initialPrompt: 'hello' });
    const started = await session.waitForEvent('agent', (e) => e.event.agentId === 'managed-1' && e.event.type === 'started');
    const raw = started.event.event.raw as { envKeys: string[]; homeIsPrivate: boolean };
    for (const key of ['GATEWAY', 'API_KEY', 'HOME_SEEN', 'MCP_SEEN']) expect(raw.envKeys).toContain(key);
    expect(raw.homeIsPrivate).toBe(true);
    expect(started.event.event.spec).toEqual({ compute: '01a0bf5d-8f4b-7f24-84a5-e66d1728cc0f', profileRevision: 2, protocol: 'opencode', model: 'anthropic/echo', permission: 'edit' });
    const context = drivers.starts[0]!.context;
    expect(context.env.HOME_SEEN).toBe(context.managed.home);
    expect(context.env.MCP_SEEN).toBe('http://mcp-operations.svc/mcp');
    const hookDone = session.eventsOf('beforeStart').find((e) => e.event.execution.agentId === 'managed-1' && e.event.execution.state === 'succeeded')!;
    expect(hookDone.event.execution.profile).toEqual({ profileId: '01a0bf5d-8f4b-7f24-84a5-e66d1728cc0f', revision: 2 });
    expect(hookDone.event.execution.steps[0]).toMatchObject({ state: 'succeeded', outputVariables: ['HOME_SEEN', 'MCP_SEEN'] });
    expect(hookDone.event.execution.steps[0]!.log).toBeUndefined();
    await session.waitForEvent('agent', (e) => e.event.agentId === 'managed-1' && e.event.type === 'completed');
    // 全部帧里不出现凭据值与会话令牌。
    expect(JSON.stringify(session.frames)).not.toContain('sk-managed');
    expect(JSON.stringify(session.frames)).not.toContain('dev-session-token-managed');
  });

  test('Hook 失败：只发 before_start_failed 的 error 事件，不创建 CLI；准备中不能发消息；取消终止准备', async () => {
    const { session, drivers } = await boot();
    await session.call({ id: 'f1', type: 'startAgent', agentId: 'failing', ...profileFields('failing', { beforeStart: profile([{ kind: 'script', stepId: '01a0bf5d-8f4b-74ee-8658-eb8e96d92b68', name: '坏脚本', language: 'shell', argv: [], timeoutMs: 10000, source: 'exit 3' }]) }), mode: 'interactive', initialPrompt: 'hi' });
    const error = await session.waitForEvent('agent', (e) => e.event.agentId === 'failing' && e.event.type === 'error');
    expect(error.event.event.error).toMatchObject({ code: 'before_start_failed' });
    expect(error.event.event.error?.message).toContain('步骤 01a0bf5d-8f4b-74ee-8658-eb8e96d92b68');
    expect(session.eventsOf('agent').some((e) => e.event.event.agentId === 'failing' && e.event.event.type === 'started')).toBe(false);
    expect(drivers.starts).toEqual([]);
    await session.call({ id: 's1', type: 'startAgent', agentId: 'slow', ...profileFields('slow', { beforeStart: profile([{ kind: 'script', stepId: '01a0bf5d-8f4b-7f6c-87bb-8ca87d3eeafb', name: '等待', language: 'shell', argv: [], timeoutMs: 30000, source: 'sleep 30' }]) }), mode: 'interactive', initialPrompt: 'hi' });
    await session.waitForEvent('beforeStart', (e) => e.execution.agentId === 'slow' && e.execution.state === 'running');
    const preparing = await session.call({ id: 's2', type: 'sendMessage', agentId: 'slow', content: 'x' }).catch((e: unknown) => e);
    expect((preparing as CommandFailure).code).toBe('agent_preparing');
    await session.call({ id: 's3', type: 'cancelAgent', agentId: 'slow' });
    await session.waitForEvent('agent', (e) => e.event.agentId === 'slow' && e.event.type === 'cancelled');
    expect(session.eventsOf('beforeStart').filter((e) => e.event.execution.agentId === 'slow').at(-1)?.event.execution.state).toBe('cancelled');
    expect(drivers.starts).toEqual([]);
  });
});
