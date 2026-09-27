import { afterEach, expect, test } from 'bun:test';
import { rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { startFakeSession } from './fakeSession';
import { startTestRunner } from './testRunner';
import { material, profileFields } from './profileFixtures';
import { echoDriverFactory } from './echoAgentDriver';
import { initializationFixture } from './runtimeInitializationFixture';

const cleanups: Array<() => Promise<void> | void> = [];
afterEach(async () => { for (const cleanup of cleanups.splice(0).reverse()) await cleanup(); });
test('真实 Runner WebSocket：连接后仍门控，初始化完成才发 ready 并接受 exec', async () => {
  const f = await initializationFixture('while [ ! -e allow ]; do sleep 0.05; done; printf x >> count'); cleanups.push(f.dispose);
  const session = startFakeSession(); cleanups.push(() => session.stop());
  const tr = await startTestRunner(session.url, { runtimeInitialization: f.config }); cleanups.push(() => tr.dispose());
  await tr.runner.whenConnected();
  expect(session.hellos[0]!.capabilities.runtimeInitialization).toBe(1);
  expect(await session.call({ id: 'state', type: 'runtimeInitializationStatus' })).toMatchObject({ enabled: true, state: 'running' });
  await expect(session.call({ id: 'blocked', type: 'exec', execId: 'blocked', command: ['sh', '-c', 'echo too-early'], env: {}, timeoutSeconds: 1, wait: true })).rejects.toMatchObject({ code: 'runtime_initialization_not_ready' });
  expect(session.eventsOf('runnerState').some((e) => e.event.state === 'ready')).toBe(false);
  await writeFile(join(f.work, 'allow'), 'yes');
  await session.waitForEvent('runnerState', (e) => e.state === 'ready');
  expect(await session.call({ id: 'allowed', type: 'exec', execId: 'allowed', command: ['sh', '-c', 'printf ready'], env: {}, timeoutSeconds: 1, wait: true })).toMatchObject({ exitCode: 0, stdout: 'ready' });
  expect(await Bun.file(join(f.work, 'count')).text()).toBe('x');
});

test('Agent 工具检查在 beforeStart 完成之后、CLI 进程之前；失败不启动 Agent', async () => {
  const f = await initializationFixture(); cleanups.push(f.dispose);
  const session = startFakeSession(); cleanups.push(() => session.stop());
  const drivers = echoDriverFactory(), marker = join(f.work, 'prepared');
  const tr = await startTestRunner(session.url, { runtimeInitialization: { ...f.config, material: { ...f.config.material, toolsPhase: 'agent-before-start', tools: [{ key: 'prepared', argv: ['sh', '-c', 'cat prepared'], cwd: f.work, timeoutSeconds: 2, expected: { kind: 'text', value: 'ready' } }] } } }, { drivers });
  cleanups.push(() => tr.dispose());
  await session.waitForEvent('runnerState', (e) => e.state === 'ready');
  expect(await Bun.file(marker).exists()).toBe(false);
  const beforeStart = material([{ kind: 'script', stepId: '01a0bf5d-8f4b-7ac6-80eb-2eff6f51a8e3', name: 'prepare', language: 'shell', argv: [], timeoutMs: 2000, source: 'printf ready > "$TOOL_MARKER"' }], { vars: { TOOL_MARKER: marker } });
  await session.call({ id: 'agent-one', type: 'startAgent', agentId: 'agent-one', ...profileFields('agent-one', { beforeStart }), mode: 'oneshot', initialPrompt: 'hello' });
  await session.waitForEvent('agent', (e) => e.event.agentId === 'agent-one' && e.event.type === 'completed');
  expect(drivers.starts).toHaveLength(1);
  expect(await session.call({ id: 'check', type: 'runtimeInitializationStatus' })).toMatchObject({ checks: [{ key: 'prepared', passed: true }] });
  await rm(marker);
  await session.call({ id: 'agent-two', type: 'startAgent', agentId: 'agent-two', ...profileFields('agent-two'), mode: 'oneshot', initialPrompt: 'hello' });
  const error = await session.waitForEvent('agent', (e) => e.event.agentId === 'agent-two' && e.event.type === 'error');
  expect(error.event.event.error?.code).toBe('before_start_failed');
  expect(drivers.starts).toHaveLength(1);
});
