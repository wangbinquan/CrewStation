import { expect, test } from 'bun:test';
import type { RunnerEvent, TaskId, UserId } from '@crewstation/contracts';
import { TASKRUNNER_PROTOCOL_VERSION } from '@crewstation/contracts';
import { fixedClock, noopLogger } from '@crewstation/kernel';
import { browserStreams } from '../application/browserStreams';
import { runnerHub } from '../application/runnerHub';
import type { SessionUseCaseDeps } from '../application/dependencies';
import type { StoredRunnerEvent } from '../ports/repositories';

const taskId = 'tsk_0123456789abcdef0123456789abcdef' as TaskId;
const actor = { userId: 'usr_0123456789abcdef0123456789abcdef' as UserId, isAdmin: false };
const at = '2026-09-13T00:00:00.000Z';
const stored = (seq: number): StoredRunnerEvent => ({ taskId, seq, at: new Date(at), event: { kind: 'runnerState', state: 'ready' } });

function fixture(listSince: SessionUseCaseDeps['events']['listSince'], replayLimit = 100, maxSeq = 0) {
  const deps: SessionUseCaseDeps = {
    clock: fixedClock(at), logger: noopLogger,
    settings: { commandTimeoutMs: 1000, runnerStaleMs: 30000, replayLimit, selfAddress: 'http://session' },
    events: { append: async () => {}, maxSeq: async () => maxSeq, listSince },
    registry: { claim: async () => {}, release: async () => {}, heartbeat: async () => {}, lookup: async () => undefined },
    runnerAuth: { verifyRunnerToken: async () => ({ ok: true, projectId: 'p' }) },
    taskAccess: { canOpenStream: async () => true, onRunnerConnected: async () => {}, onRunnerDisconnected: async () => {} },
    forwarder: { forward: async () => ({}) },
  };
  const commands: unknown[] = [];
  const hub = runnerHub(deps);
  const streams = browserStreams(deps, hub, { sendCommand: async (_task, command) => { commands.push(command); return {}; }, sendLocalOnly: async () => ({}), connectionStatus: async () => ({ connected: true }) });
  const connect = () => hub.onHello({ type: 'hello', taskId, protocolVersion: TASKRUNNER_PROTOCOL_VERSION, runnerToken: 'token', workdir: '/work', capabilities: { protocols: ['claude-code', 'opencode', 'terminal'], pty: true, preview: true } }, { send: () => {} });
  return { hub, streams, connect, commands };
}

test('数据库回放期间订阅实时事件：重叠只发一次，低于持久高水位的临时输出仍保留并按 seq 排序', async () => {
  const waiting = Promise.withResolvers<StoredRunnerEvent[]>();
  const entered = Promise.withResolvers<void>();
  const f = fixture(async () => { entered.resolve(); return waiting.promise; });
  const connection = await f.connect(); if (!connection.ok) throw new Error(connection.message);
  const frames: Array<{ type: string; seq?: number }> = [];
  const opening = f.streams.open(actor, taskId, { send: (raw) => frames.push(JSON.parse(raw)) }, 0);
  await entered.promise;
  const emit = (seq: number, event: RunnerEvent) => f.hub.onMessage(connection.connection, { type: 'event', seq, at, event });
  await emit(2, { kind: 'terminalOutput', terminalId: 'pty', data: 'during replay' });
  await emit(3, stored(3).event);
  await emit(4, { kind: 'terminalOutput', terminalId: 'pty', data: 'live tail' });
  waiting.resolve([stored(1), stored(3)]);
  const stream = await opening;
  expect(frames.filter((x) => x.type === 'event').map((x) => x.seq)).toEqual([1, 2, 3, 4]);
  expect(frames.at(-1)).toMatchObject({ type: 'streamReady', connected: true, replayComplete: true });
  stream.close();
});

test('历史超过单次上限时明确续接游标，不发跨过缺口的实时事件，也不提前派发命令', async () => {
  const f = fixture(async (_task, since, options) => [stored(1), stored(2), stored(3)].filter((e) => e.seq > since).slice(0, options.limit), 2);
  const frames: unknown[] = [];
  const stream = await f.streams.open(actor, taskId, { send: (raw) => frames.push(JSON.parse(raw)) }, 0);
  expect(frames.at(-1)).toMatchObject({ type: 'streamReady', connected: false, replayed: 2, replayComplete: false, resumeFromSeq: 2 });
  await stream.onMessage({ id: 'list', type: 'listFiles', path: '.' });
  expect(f.commands).toHaveLength(0);
  expect(frames.at(-1)).toMatchObject({ type: 'error', code: 'replay_pending' });
  stream.close();
  const next: unknown[] = [];
  const continued = await f.streams.open(actor, taskId, { send: (raw) => next.push(JSON.parse(raw)) }, 2);
  expect(next[0]).toMatchObject({ type: 'event', seq: 3 });
  expect(next.at(-1)).toMatchObject({ type: 'streamReady', replayComplete: true });
  continued.close();
});

test('回放失败或发送失败必须释放临时订阅', async () => {
  const f = fixture(async () => { throw new Error('database unavailable'); });
  const connection = await f.connect(); if (!connection.ok) throw new Error(connection.message);
  await expect(f.streams.open(actor, taskId, { send: () => {} }, 0)).rejects.toThrow('database unavailable');
  expect(connection.connection.subscribers.size).toBe(0);
  const g = fixture(async () => [stored(1)]);
  const second = await g.connect(); if (!second.ok) throw new Error(second.message);
  await expect(g.streams.open(actor, taskId, { send: () => { throw new Error('socket closed'); } }, 0)).rejects.toThrow('socket closed');
  expect(second.connection.subscribers.size).toBe(0);
});

test('回放期间实时缓冲溢出时要求按持久游标续接，不能伪称完整', async () => {
  const waiting = Promise.withResolvers<StoredRunnerEvent[]>();
  const entered = Promise.withResolvers<void>();
  const f = fixture(async () => { entered.resolve(); return waiting.promise; });
  const connection = await f.connect(); if (!connection.ok) throw new Error(connection.message);
  const frames: unknown[] = [];
  const opening = f.streams.open(actor, taskId, { send: (raw) => frames.push(JSON.parse(raw)) }, 0);
  await entered.promise;
  for (let seq = 1; seq <= 1100; seq++) await f.hub.onMessage(connection.connection, { type: 'event', seq, at, event: { kind: 'terminalOutput', terminalId: 'pty', data: 'output' } });
  waiting.resolve([stored(1)]);
  const stream = await opening;
  expect(frames.at(-1)).toMatchObject({ type: 'streamReady', replayComplete: false, resumeFromSeq: 1 });
  expect(connection.connection.subscribers.size).toBe(0);
  stream.close();
});

test('被新 Runner 连接替换后，旧连接晚到的事件不能覆盖当前状态', async () => {
  const f = fixture(async () => []);
  const first = await f.connect(); if (!first.ok) throw new Error(first.message);
  const frames: unknown[] = [];
  const stream = await f.streams.open(actor, taskId, { send: (raw) => frames.push(JSON.parse(raw)) }, 0);
  const second = await f.connect(); if (!second.ok) throw new Error(second.message);
  const before = frames.length;
  await f.hub.onMessage(first.connection, { type: 'event', seq: 100, at, event: stored(100).event });
  expect(frames).toHaveLength(before);
  await f.hub.onMessage(second.connection, { type: 'event', seq: 1, at, event: stored(1).event });
  expect(frames.at(-1)).toMatchObject({ type: 'event', seq: 1 });
  stream.close();
});

test('首次打开带 replay=tail 只回放最近一页并注明起点；续接游标不受影响', async () => {
  const history = Array.from({ length: 350 }, (_, i) => stored(i + 1));
  const listSince: SessionUseCaseDeps['events']['listSince'] = async (_task, since, options) => history.filter((e) => e.seq > since).slice(0, options.limit);
  const f = fixture(listSince, 100, 350);
  const connection = await f.connect(); if (!connection.ok) throw new Error(connection.message);
  const frames: Array<{ type: string; seq?: number }> = [];
  const stream = await f.streams.open(actor, taskId, { send: (raw) => frames.push(JSON.parse(raw)) }, 0, { tail: true });
  const seqs = frames.filter((x) => x.type === 'event').map((x) => x.seq);
  expect(seqs[0]).toBe(251); expect(seqs.at(-1)).toBe(350); expect(seqs).toHaveLength(100);
  expect(frames.at(-1)).toMatchObject({ type: 'streamReady', connected: true, replayed: 100, replayComplete: true, replayFromSeq: 250 });
  stream.close();
  // 续接：客户端已有游标时按游标补齐，不再截尾，也不带 replayFromSeq。
  const next: Array<{ type: string; seq?: number; replayFromSeq?: number }> = [];
  const continued = await f.streams.open(actor, taskId, { send: (raw) => next.push(JSON.parse(raw)) }, 340, { tail: true });
  expect(next.filter((x) => x.type === 'event').map((x) => x.seq)).toEqual([341, 342, 343, 344, 345, 346, 347, 348, 349, 350]);
  expect(next.at(-1)).toMatchObject({ type: 'streamReady', replayComplete: true }); expect(next.at(-1)!.replayFromSeq).toBeUndefined();
  continued.close();
});
