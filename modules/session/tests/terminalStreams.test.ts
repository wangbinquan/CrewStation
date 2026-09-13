import { expect, test } from 'bun:test';
import type { RunnerCommand, RunnerEvent, TaskId, UserId } from '@crewstation/contracts';
import { TASKRUNNER_PROTOCOL_VERSION } from '@crewstation/contracts';
import { fixedClock, noopLogger } from '@crewstation/kernel';
import { browserStreams } from '../application/browserStreams';
import { runnerHub } from '../application/runnerHub';
import type { SessionUseCaseDeps } from '../application/dependencies';
import { terminalViewCommand } from '../domain/terminalViews';
import { StartAgentTerminalCommandSchema } from '@crewstation/contracts';

const taskId = 'tsk_0123456789abcdef0123456789abcdef' as TaskId;
const actor = { userId: 'usr_0123456789abcdef0123456789abcdef' as UserId, isAdmin: false };
const at = '2026-09-13T00:00:00.000Z';

function fixture() {
  const durable: RunnerEvent[] = [];
  const commands: RunnerCommand[] = [];
  const deps: SessionUseCaseDeps = {
    clock: fixedClock(at), logger: noopLogger,
    settings: { commandTimeoutMs: 1000, runnerStaleMs: 30000, replayLimit: 100, selfAddress: 'http://session' },
    events: { append: async (e) => { durable.push(e.event); }, maxSeq: async () => 0, listSince: async () => [] },
    registry: { claim: async () => {}, release: async () => {}, heartbeat: async () => {}, lookup: async () => undefined },
    runnerAuth: { verifyRunnerToken: async () => ({ ok: true, projectId: 'p' }) },
    taskAccess: { canOpenStream: async () => true, onRunnerConnected: async () => {}, onRunnerDisconnected: async () => {} },
    forwarder: { forward: async () => ({}) },
  };
  const hub = runnerHub(deps);
  const streams = browserStreams(deps, hub, { sendCommand: async (_task, c) => { commands.push(c); return {}; }, sendLocalOnly: async () => ({}), connectionStatus: async () => ({ connected: true }) });
  const hello = { type: 'hello', taskId, protocolVersion: TASKRUNNER_PROTOCOL_VERSION, runnerToken: 'token', workdir: '/work', capabilities: { drivers: ['claude-code'], pty: true, preview: true } };
  return { hub, streams, hello, durable, commands };
}

test('浏览器先开而 Runner 尚未连接，之后连接／断线／重连均继续收到原生名册状态', async () => {
  const f = fixture();
  const frames: unknown[] = [];
  const stream = await f.streams.open(actor, taskId, { send: (raw) => frames.push(JSON.parse(raw)) }, 0);
  expect(frames[0]).toMatchObject({ type: 'streamReady', connected: false });
  const first = await f.hub.onHello(f.hello, { send: () => {} });
  if (!first.ok) throw new Error(first.message);
  await f.hub.onMessage(first.connection, { type: 'event', seq: 1, at, event: { kind: 'nativeTerminal', terminal: { agentId: 'a', terminalId: 't', runnerId: crypto.randomUUID(), revision: 2, compute: 'balanced', permission: 'edit', lifecycle: 'running', startedAt: at, cols: 80, rows: 24 } } });
  expect(frames).toContainEqual(expect.objectContaining({ type: 'event', seq: 1 }));
  expect(f.durable).toHaveLength(1);
  await f.hub.onClose(first.connection);
  const second = await f.hub.onHello(f.hello, { send: () => {} });
  if (!second.ok) throw new Error(second.message);
  await f.hub.onMessage(second.connection, { type: 'event', seq: 2, at, event: { kind: 'terminalOutput', terminalId: 't', terminalSeq: 1, data: 'after reconnect' } });
  expect(frames).toContainEqual(expect.objectContaining({ type: 'event', seq: 2 }));
  expect(f.durable).toHaveLength(1);
  stream.close();
  const before = frames.length;
  await f.hub.onMessage(second.connection, { type: 'event', seq: 3, at, event: { kind: 'terminalOutput', terminalId: 't', data: 'detached' } });
  expect(frames).toHaveLength(before);
});

test('控制租约绑定服务端视图，断开只 detach；不同连接不能复用客户端伪造的 viewId', async () => {
  const f = fixture();
  const one = await f.streams.open(actor, taskId, { send: () => {} }, 0);
  const two = await f.streams.open(actor, taskId, { send: () => {} }, 0);
  const claim = { id: 'claim', type: 'claimTerminalControl', terminalId: 't', runnerId: crypto.randomUUID(), viewId: 'pretend-same-view' };
  await one.onMessage(claim);
  await two.onMessage({ ...claim, id: 'claim-2' });
  const first = f.commands[0] as Extract<RunnerCommand, { type: 'claimTerminalControl' }>;
  const second = f.commands[1] as typeof first;
  expect(first.viewId).not.toBe('pretend-same-view');
  expect(first.viewId).not.toBe(second.viewId);
  await one.onMessage({ id: 'input', type: 'terminalInput', terminalId: 't', data: '\x03', viewId: second.viewId });
  expect(f.commands[2]).toMatchObject({ type: 'terminalInput', viewId: first.viewId });
  one.close();
  expect(f.commands.at(-1)).toMatchObject({ type: 'detachTerminal', viewId: first.viewId });
  expect(f.commands.some((c) => c.type === 'stopAgentTerminal' || c.type === 'closeTerminal')).toBe(false);
  two.close();
});

test('原生 CLI 创建和结束必须经过持久名册接口，浏览器流不能绕过；普通终端旧命令保留', () => {
  const native = StartAgentTerminalCommandSchema.parse({ id: 'start', type: 'startAgentTerminal', agentId: 'a', terminalId: 't', runnerId: crypto.randomUUID(), requestFingerprint: 'fingerprint', driver: 'claude-code', compute: 'balanced', model: 'model', permission: 'edit', cols: 80, rows: 24 });
  expect(() => terminalViewCommand(native, 'view')).toThrow('名册');
  expect(() => terminalViewCommand({ id: 'stop', type: 'stopAgentTerminal', agentId: 'a', runnerId: native.runnerId }, 'view')).toThrow('名册');
  expect(terminalViewCommand({ id: 'shell', type: 'openTerminal', terminalId: 'shell', cols: 80, rows: 24 }, 'view')).toMatchObject({ type: 'openTerminal' });
});
