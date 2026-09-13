import { afterEach, expect, test } from 'bun:test';
import type { NativeActivityEvent } from '@crewstation/contracts';
import { NativeActivityEventSchema } from '@crewstation/contracts';
import { createOpencodeActivityChannel } from '../src/activity/nativeActivityChannel';

const cleanups: Array<() => void> = [];
afterEach(() => { for (const close of cleanups.splice(0)) close(); });
const at = '2026-09-13T08:00:00.000Z';
function fixture(leaseMs = 20000, notify?: (event: NativeActivityEvent) => void) {
  const events: NativeActivityEvent[] = [];
  const observer = createOpencodeActivityChannel({ agentId: 'cli-a', terminalId: 'term-a', runnerId: '4b6ae7d3-c955-41a9-8b1e-cb6360ed0b36', leaseMs, emit: (event) => { events.push(NativeActivityEventSchema.parse(event)); notify?.(event); } });
  cleanups.push(observer.close);
  const post = (sequence: number, event: unknown, token = observer.options.token) => fetch(observer.options.endpoint, { method: 'POST', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' }, body: JSON.stringify({ protocol: 1, sequence, event }) });
  let sequence = 0;
  const send = (event: Record<string, unknown>) => post(++sequence, { sessionId: 'session', eventId: `event-${sequence}`, at, ...event });
  return { observer, events, post, send, kinds: () => events.map((event) => event.signal.kind) };
}

test('真实 HTTP 状态通道序号、轮次与请求身份完整，补发不会重复；显式关闭只发一次退出', async () => {
  const f = fixture();
  await f.send({ type: 'ready', sessionId: undefined, eventId: undefined, at: undefined });
  await f.send({ type: 'session', parentId: null });
  await f.send({ type: 'prompt', messageId: 'u1' });
  await f.send({ type: 'assistant', messageId: 'a1', parentId: 'u1', createdAt: 1, completed: false });
  await f.send({ type: 'request', requestId: 'q1', requestKind: 'question', messageId: 'a1' });
  await f.send({ type: 'resolved', requestId: 'q1', resolution: 'answered' });
  await f.send({ type: 'assistant', messageId: 'a1', parentId: 'u1', createdAt: 1, completed: true, finish: 'stop' });
  await f.send({ type: 'status', status: 'idle' });
  await f.post(8, { type: 'status', sessionId: 'session', eventId: 'event-8', at, status: 'idle' });
  expect(f.kinds()).toEqual(['source-ready', 'turn-started', 'request-opened', 'request-resolved', 'turn-completed']);
  expect(f.events.slice(1).every((event) => event.turnOrdinal === 1 && event.signal.turnId === 'session:u1')).toBe(true);
  expect(f.events.map((event) => event.seq)).toEqual([1, 2, 3, 4, 5]);
  expect(new Set(f.events.map((event) => event.eventId)).size).toBe(5);
  f.observer.close(); f.observer.close();
  expect(f.kinds().filter((kind) => kind === 'process-ended')).toHaveLength(1);
});

test('未授权调用不改变状态；源序号缺口永久降级而不接受后来的完成', async () => {
  const f = fixture();
  expect((await f.post(1, { type: 'ready' }, 'wrong-token')).status).toBe(403);
  expect(f.events).toEqual([]);
  await f.post(1, { type: 'ready' });
  await f.post(3, { type: 'session', sessionId: 'session', eventId: 'e3', at, parentId: null });
  await f.post(4, { type: 'prompt', sessionId: 'session', eventId: 'e4', at, messageId: 'u1' });
  await f.post(5, { type: 'ready' });
  expect(f.kinds()).toEqual(['source-ready', 'source-unavailable']);
  expect(f.events[1]?.signal.reason).toBe('channel-gap');
});

test('正文／未知字段被严格拒绝，畸形事件不作为正常输入', async () => {
  const f = fixture(); await f.post(1, { type: 'ready' });
  const response = await f.post(2, { type: 'prompt', sessionId: 'session', messageId: 'u1', eventId: 'e2', at, text: 'not allowed' });
  expect(response.status).toBe(400);
  expect(f.kinds()).toEqual(['source-ready', 'source-unavailable']);
});

test('心跳到期是状态通道故障，迟到的 ready 不把它恢复成成功；其他 CLI 不受影响', async () => {
  let resolve!: () => void;
  const expired = new Promise<void>((done) => { resolve = done; });
  const f = fixture(30, (event) => { if (event.signal.kind === 'source-unavailable') resolve(); });
  const other = fixture(); await other.post(1, { type: 'ready' });
  await expired;
  await f.post(1, { type: 'ready' });
  expect(f.kinds()).toEqual(['source-unavailable']);
  expect(other.kinds()).toEqual(['source-ready']);
  expect(f.events[0]?.eventId).not.toBe(other.events[0]?.eventId);
});
