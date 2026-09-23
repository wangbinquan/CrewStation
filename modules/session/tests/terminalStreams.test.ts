import { expect, test } from 'bun:test';
import type { RunnerCommand, RunnerEvent, TaskId, UserId } from '@crewstation/contracts';
import type { StoredRunnerEvent } from '../ports/repositories';
import { TASKRUNNER_PROTOCOL_VERSION } from '@crewstation/contracts';
import { fixedClock, noopLogger } from '@crewstation/kernel';
import { browserStreams } from '../application/browserStreams';
import { runnerHub } from '../application/runnerHub';
import type { SessionUseCaseDeps } from '../application/dependencies';
import { terminalViewCommand } from '../domain/terminalViews';
import { StartAgentTerminalCommandSchema } from '@crewstation/contracts';

const taskId = '01a0bf5d-8f4b-7418-8a3f-7cbb4a1fd751' as TaskId;
const actor = { userId: '01a0bf5d-8f4b-7793-867c-efd7527b386b' as UserId, isAdmin: false };
const at = '2026-09-13T00:00:00.000Z';

function fixture() {
  const durable: RunnerEvent[] = [];
  const records: StoredRunnerEvent[] = [];
  const commands: RunnerCommand[] = [];
  const deps: SessionUseCaseDeps = {
    clock: fixedClock(at), logger: noopLogger,
    settings: { commandTimeoutMs: 1000, runnerStaleMs: 30000, replayLimit: 100, selfAddress: 'http://session' },
    events: { append: async (e) => { durable.push(e.event); records.push(e); }, maxSeq: async () => 0, listSince: async (_taskId, since, options) => records.filter((event) => event.seq > since).slice(0, options.limit) },
    registry: { claim: async () => {}, release: async () => {}, heartbeat: async () => {}, lookup: async () => undefined },
    runnerAuth: { verifyRunnerToken: async () => ({ ok: true, projectId: 'p' }) },
    taskAccess: { canOpenStream: async () => true, onRunnerConnected: async () => {}, onRunnerDisconnected: async () => {} },
    forwarder: { forward: async () => ({}) },
  };
  const hub = runnerHub(deps);
  const streams = browserStreams(deps, hub, { sendCommand: async (_task, c) => { commands.push(c); return {}; }, sendLocalOnly: async () => ({}), connectionStatus: async () => ({ connected: true }) });
  const hello = { type: 'hello', taskId, protocolVersion: TASKRUNNER_PROTOCOL_VERSION, runnerToken: 'token', workdir: '/work', capabilities: { protocols: ['claude-code', 'opencode', 'terminal'], pty: true, preview: true } };
  return { hub, streams, hello, durable, commands };
}

test('浏览器先开而 Runner 尚未连接，之后连接／断线／重连均继续收到原生名册状态', async () => {
  const f = fixture();
  const frames: unknown[] = [];
  const stream = await f.streams.open(actor, taskId, { send: (raw) => frames.push(JSON.parse(raw)) }, 0);
  expect(frames[0]).toMatchObject({ type: 'streamReady', connected: false });
  const first = await f.hub.onHello(f.hello, { send: () => {} });
  await new Promise((resolve) => setTimeout(resolve, 0));
  if (!first.ok) throw new Error(first.message);
  await f.hub.onMessage(first.connection, { type: 'event', seq: 1, at, event: { kind: 'nativeTerminal', terminal: { agentId: 'a', terminalId: 't', runnerId: crypto.randomUUID(), revision: 2, compute: '01a0bf5d-8f4b-7ad6-85af-678b84e2f6f6', permission: 'edit', lifecycle: 'running', startedAt: at, cols: 80, rows: 24 } } });
  await new Promise((resolve) => setTimeout(resolve, 0));
  expect(frames).toContainEqual(expect.objectContaining({ type: 'event', seq: 1 }));
  expect(f.durable).toHaveLength(1);
  await f.hub.onClose(first.connection);
  const second = await f.hub.onHello(f.hello, { send: () => {} });
  await new Promise((resolve) => setTimeout(resolve, 0));
  if (!second.ok) throw new Error(second.message);
  await f.hub.onMessage(second.connection, { type: 'event', seq: 2, at, event: { kind: 'terminalOutput', terminalId: 't', terminalSeq: 1, data: 'after reconnect' } });
  await new Promise((resolve) => setTimeout(resolve, 0));
  expect(frames).toContainEqual(expect.objectContaining({ type: 'event', seq: 2 }));
  expect(f.durable).toHaveLength(1);
  stream.close();
  const before = frames.length;
  await f.hub.onMessage(second.connection, { type: 'event', seq: 3, at, event: { kind: 'terminalOutput', terminalId: 't', data: 'detached' } });
  await new Promise((resolve) => setTimeout(resolve, 0));
  expect(frames).toHaveLength(before);
});

test('后台原生状态在没有浏览器订阅时仍持久化，稍后按游标回放身份与请求状态', async () => {
  const f = fixture(); const connected = await f.hub.onHello(f.hello, { send: () => {} });
  await new Promise((resolve) => setTimeout(resolve, 0));
  if (!connected.ok) throw new Error(connected.message);
  const activity = { agentId: 'a', terminalId: 't', runnerId: crypto.randomUUID(), eventId: crypto.randomUUID(), seq: 2, turnOrdinal: 1, signal: { source: 'opencode/1.18.29', sourceEventId: 'request', kind: 'request-opened', occurredAt: at, nativeSessionId: 'session', turnId: 'turn', request: { id: 'question-1', kind: 'question' } } };
  await f.hub.onMessage(connected.connection, { type: 'event', seq: 1, at, event: { kind: 'nativeActivity', activity } });
  await new Promise((resolve) => setTimeout(resolve, 0));
  await f.hub.onMessage(connected.connection, { type: 'event', seq: 2, at, event: { kind: 'terminalOutput', terminalId: 't', data: 'transient' } });
  await new Promise((resolve) => setTimeout(resolve, 0));
  expect(f.durable).toHaveLength(1);
  const frames: unknown[] = [];
  const stream = await f.streams.open(actor, taskId, { send: (raw) => frames.push(JSON.parse(raw)) }, 0);
  expect(frames[0]).toMatchObject({ type: 'event', seq: 1, event: { kind: 'nativeActivity', activity } });
  stream.close();
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

test('取得输入控制的持有人只认连接的网关身份，浏览器自带的一律丢弃；换人事件实时转发、不落库', async () => {
  const f = fixture();
  const frames: unknown[] = [];
  const stream = await f.streams.open(actor, taskId, { send: (raw) => frames.push(JSON.parse(raw)) }, 0, { viewerName: '张三' });
  const forged = { id: 'claim', type: 'claimTerminalControl', terminalId: 't', runnerId: crypto.randomUUID(), viewId: 'forged', holder: { userId: 'someone-else', name: '李四' } };
  await stream.onMessage(forged);
  expect(f.commands[0]).toMatchObject({ type: 'claimTerminalControl', holder: { userId: actor.userId, name: '张三' } });
  expect(terminalViewCommand(forged as RunnerCommand, 'view')).not.toHaveProperty('holder');
  const connected = await f.hub.onHello(f.hello, { send: () => {} });
  await new Promise((resolve) => setTimeout(resolve, 0));
  if (!connected.ok) throw new Error(connected.message);
  const control = { held: true, holder: { userId: actor.userId, name: '张三' }, revision: 1 };
  await f.hub.onMessage(connected.connection, { type: 'event', seq: 1, at, event: { kind: 'terminalControl', terminalId: 't', runnerId: crypto.randomUUID(), control } });
  await new Promise((resolve) => setTimeout(resolve, 0));
  expect(frames).toContainEqual(expect.objectContaining({ type: 'event', seq: 1, event: expect.objectContaining({ kind: 'terminalControl', control }) }));
  expect(f.durable).toHaveLength(0);
  stream.close();
});

test('原生 CLI 创建和结束必须经过持久名册接口，浏览器流不能绕过；普通终端旧命令保留', () => {
  const native = StartAgentTerminalCommandSchema.parse({ id: 'start', type: 'startAgentTerminal', agentId: 'a', terminalId: 't', runnerId: crypto.randomUUID(), requestFingerprint: 'fingerprint', compute: '01a0bf5d-8f4b-7ad6-85af-678b84e2f6f6', profileRevision: 1, launch: { protocol: 'claude-code', binaryPath: '/usr/local/bin/claude', model: 'model' }, permission: 'edit', cols: 80, rows: 24,
    beforeStart: { profile: '01a0bf5d-8f4b-7ad6-85af-678b84e2f6f6', revision: 1, contentHash: 'h', steps: [], vars: {}, secrets: {}, configFile: { kind: 'none' }, captureOutput: false }, processAttemptId: 'a:1' });
  expect(() => terminalViewCommand(native, 'view')).toThrow('名册');
  expect(() => terminalViewCommand({ id: 'stop', type: 'stopAgentTerminal', agentId: 'a', runnerId: native.runnerId }, 'view')).toThrow('名册');
  expect(terminalViewCommand({ id: 'shell', type: 'openTerminal', terminalId: 'shell', cols: 80, rows: 24 }, 'view')).toMatchObject({ type: 'openTerminal' });
});
