import { afterEach, describe, expect, test } from 'bun:test';
import { chmod, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { AgentRuntimeMaterial } from '@crewstation/contracts';
import { createClaudeCodeCliDriver, createOpencodeCliDriver } from '../src/agents/cliDriver';
import { createDriverRegistry } from '../src/agents/registry';
import { createStubDriver } from '../src/agents/stubDriver';
import type { FakeSession } from './fakeSession';
import type { CommandFailure } from './fakeSession';
import { startFakeSession } from './fakeSession';
import type { TestRunner } from './testRunner';
import { startTestRunner } from './testRunner';

const cleanups: Array<() => Promise<void> | void> = [];
afterEach(async () => { for (const cleanup of cleanups.splice(0).reverse()) await cleanup(); });

async function boot(): Promise<{ session: FakeSession; tr: TestRunner; scratch: string }> {
  const scratch = await mkdtemp(join(tmpdir(), 'cs-managed-'));
  cleanups.push(() => rm(scratch, { recursive: true, force: true }));
  const agentEnvFile = join(scratch, 'agent.env');
  await writeFile(agentEnvFile, 'LEGACY_MODEL_KEY=legacy-secret\n');
  await chmod(agentEnvFile, 0o600);
  const session = startFakeSession();
  cleanups.push(() => session.stop());
  const absent = { which: () => null };
  const tr = await startTestRunner(session.url, { agentEnvFile, agentRunDir: join(scratch, 'agents') }, { registry: createDriverRegistry([createStubDriver(), createClaudeCodeCliDriver(absent), createOpencodeCliDriver(absent)]) });
  cleanups.push(() => tr.dispose());
  await tr.runner.whenConnected();
  return { session, tr, scratch };
}

const runtime = (steps: AgentRuntimeMaterial['steps']): AgentRuntimeMaterial => ({ configId: 'arc_' + 'b'.repeat(32), configName: 'managed', revision: 2, driver: 'opencode', contentHash: 'h', steps, vars: { GATEWAY: 'https://gw' }, secrets: { API_KEY: 'sk-managed' }, configFile: { kind: 'none' }, captureOutput: false });

describe('托管启动经真实 Runner 协议（RFC-004）', () => {
  test('hello 宣告 agentRuntimeConfig 与解释器；托管 startAgent 先跑 Hook 再起 Agent，不混入旧凭据文件', async () => {
    const { session } = await boot();
    const hello = await session.waitFor(() => session.hellos[0]);
    expect(hello.capabilities.agentRuntimeConfig).toBe(1);
    expect(hello.capabilities.interpreters?.map((i) => i.language)).toContain('shell');
    await session.call({ id: 'm1', type: 'startAgent', agentId: 'managed-1', compute: 'managed', driver: 'stub', model: 'stub/echo', permission: 'edit', mode: 'oneshot', initialPrompt: 'hello', processAttemptId: 'managed-1:1',
      runtime: runtime([{ kind: 'script', stepId: 'probe', name: '记录 HOME', language: 'shell', argv: [], timeoutMs: 10000, source: 'printf \'{"HOME_SEEN":"%s","LEGACY_SEEN":"%s"}\' "$HOME" "${LEGACY_MODEL_KEY:-absent}" > "$CS_HOOK_ENV_OUT"' }]) });
    const started = await session.waitForEvent('agent', (e) => e.event.agentId === 'managed-1' && e.event.type === 'started');
    const raw = started.event.event.raw as { envKeys: string[] };
    expect(raw.envKeys).toContain('GATEWAY'); expect(raw.envKeys).toContain('API_KEY'); expect(raw.envKeys).toContain('HOME_SEEN'); expect(raw.envKeys).toContain('LEGACY_SEEN');
    expect(raw.envKeys).not.toContain('LEGACY_MODEL_KEY');
    expect(started.event.event.spec).toMatchObject({ runtime: { configId: 'arc_' + 'b'.repeat(32), revision: 2 } });
    const hookDone = session.eventsOf('beforeStart').find((e) => e.event.execution.agentId === 'managed-1' && e.event.execution.state === 'succeeded')!;
    expect(hookDone.event.execution.steps[0]).toMatchObject({ state: 'succeeded', outputVariables: ['HOME_SEEN', 'LEGACY_SEEN'] });
    expect(hookDone.event.execution.steps[0]!.log).toBeUndefined();
    await session.waitForEvent('agent', (e) => e.event.agentId === 'managed-1' && e.event.type === 'completed');
    // 部署配置模式仍读旧凭据文件：两条路径不混合。
    await session.call({ id: 'l1', type: 'startAgent', agentId: 'legacy-1', compute: 'legacy', driver: 'stub', model: 'stub/echo', permission: 'edit', mode: 'oneshot', initialPrompt: 'hi' });
    const legacy = await session.waitForEvent('agent', (e) => e.event.agentId === 'legacy-1' && e.event.type === 'started');
    expect((legacy.event.event.raw as { envKeys: string[] }).envKeys).toContain('LEGACY_MODEL_KEY');
    // 全部帧里不出现凭据值。
    expect(JSON.stringify(session.frames)).not.toContain('sk-managed');
    expect(JSON.stringify(session.frames)).not.toContain('legacy-secret');
  });

  test('Hook 失败：只发 before_start_failed 的 error 事件，不创建 CLI；准备中不能发消息；取消终止准备', async () => {
    const { session } = await boot();
    await session.call({ id: 'f1', type: 'startAgent', agentId: 'failing', compute: 'managed', driver: 'stub', model: 'stub/echo', permission: 'edit', mode: 'interactive', initialPrompt: 'hi', processAttemptId: 'failing:1',
      runtime: runtime([{ kind: 'script', stepId: 'bad', name: '坏脚本', language: 'shell', argv: [], timeoutMs: 10000, source: 'exit 3' }]) });
    const error = await session.waitForEvent('agent', (e) => e.event.agentId === 'failing' && e.event.type === 'error');
    expect(error.event.event.error).toMatchObject({ code: 'before_start_failed' });
    expect(error.event.event.error?.message).toContain('步骤 bad');
    expect(session.eventsOf('agent').some((e) => e.event.event.agentId === 'failing' && e.event.event.type === 'started')).toBe(false);
    await session.call({ id: 's1', type: 'startAgent', agentId: 'slow', compute: 'managed', driver: 'stub', model: 'stub/echo', permission: 'edit', mode: 'interactive', initialPrompt: 'hi', processAttemptId: 'slow:1',
      runtime: runtime([{ kind: 'script', stepId: 'wait', name: '等待', language: 'shell', argv: [], timeoutMs: 30000, source: 'sleep 30' }]) });
    await session.waitForEvent('beforeStart', (e) => e.execution.agentId === 'slow' && e.execution.state === 'running');
    const preparing = await session.call({ id: 's2', type: 'sendMessage', agentId: 'slow', content: 'x' }).catch((e: unknown) => e);
    expect((preparing as CommandFailure).code).toBe('agent_preparing');
    await session.call({ id: 's3', type: 'cancelAgent', agentId: 'slow' });
    await session.waitForEvent('agent', (e) => e.event.agentId === 'slow' && e.event.type === 'cancelled');
    expect(session.eventsOf('beforeStart').filter((e) => e.event.execution.agentId === 'slow').at(-1)?.event.execution.state).toBe('cancelled');
  });
});
