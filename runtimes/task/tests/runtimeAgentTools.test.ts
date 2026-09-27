import { afterEach, expect, test } from 'bun:test';
import { join } from 'node:path';
import { InitializationJournal } from '../src/initialization/journal';
import { initializationFixture } from './runtimeInitializationFixture';

const cleanups: Array<() => Promise<void>> = [];
afterEach(async () => { for (const cleanup of cleanups.splice(0).reverse()) await cleanup(); });
async function fixture(script = 'printf x >> tool-count; printf ready') {
  const f = await initializationFixture('true'); cleanups.push(f.dispose);
  const config = { ...f.config, material: { ...f.config.material, toolsPhase: 'agent-before-start' as const, tools: [{ key: 'tool', argv: ['/bin/sh', '-c', script], cwd: f.work, timeoutSeconds: 5, expected: { kind: 'text' as const, value: 'ready' } }] } };
  return { ...f, config };
}

test('Agent 工具检查重连和 Runner 重启复用成功记录，新进程尝试独立检查', async () => {
  const f = await fixture(), first = f.make(f.config), signal = new AbortController().signal;
  await first.start(); await first.checkAgentTools('attempt-one', {}, signal);
  await first.checkAgentTools('attempt-one', {}, signal); await first.close();
  const resumed = f.make(f.config); await resumed.start(); await resumed.checkAgentTools('attempt-one', {}, signal);
  expect(await Bun.file(join(f.work, 'tool-count')).text()).toBe('x');
  await resumed.checkAgentTools('attempt-two', {}, signal);
  expect(await Bun.file(join(f.work, 'tool-count')).text()).toBe('xx');
});

test('未确认的 Agent 工具检查不重执行副作用', async () => {
  const f = await fixture(), first = f.make(f.config); await first.start(); const state = first.status(); await first.close();
  const executionId = new Bun.CryptoHasher('sha256').update(`${state.executionId}/tools/lost-attempt`).digest('hex');
  const journal = new InitializationJournal(f.config.journalDir); journal.reserve({ ...state, executionId, state: 'running', checks: [] }); journal.close();
  const resumed = f.make(f.config); await resumed.start();
  await expect(resumed.checkAgentTools('lost-attempt', {}, new AbortController().signal)).rejects.toMatchObject({ code: 'runtime_tool_check_unknown' });
  expect(await Bun.file(join(f.work, 'tool-count')).exists()).toBe(false);
});

test('Runner 关闭等待正在执行的工具退出并持久取消，不能提前关闭日志库', async () => {
  const f = await fixture('sleep 20'), init = f.make(f.config); await init.start();
  const started = Promise.withResolvers<void>(), spawn = f.launcher.spawnPiped.bind(f.launcher);
  f.launcher.spawnPiped = (spec) => { const child = spawn(spec); started.resolve(); return child; };
  const check = init.checkAgentTools('closing-attempt', {}, new AbortController().signal).then(() => undefined, (error: unknown) => error);
  await started.promise; await init.close();
  expect(await check).toMatchObject({ code: 'runtime_tool_check_failed' });
  const resumed = f.make(f.config); await resumed.start();
  await expect(resumed.checkAgentTools('closing-attempt', {}, new AbortController().signal)).rejects.toMatchObject({ code: 'runtime_tool_check_unknown' });
});
