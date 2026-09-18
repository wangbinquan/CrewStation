import { afterEach, expect, test } from 'bun:test';
import type { RunnerHello, TaskId } from '@crewstation/contracts';
import { TASKRUNNER_PROTOCOL_VERSION } from '@crewstation/contracts';
import { noopLogger } from '@crewstation/kernel';
import { createSessionLink } from '../src/sessionLink';
import { startFakeSession } from './fakeSession';

const cleanups: Array<() => void> = [];
afterEach(() => { for (const fn of cleanups.splice(0).reverse()) fn(); });
const hello: RunnerHello = { type: 'hello', taskId: 'tsk_0123456789abcdef0123456789abcdef' as TaskId, protocolVersion: TASKRUNNER_PROTOCOL_VERSION, runnerToken: 'test', workdir: '/work', capabilities: { protocols: [], pty: false, preview: false } };

test('新 Runner 在已有持久游标之后开始 seq，首次握手前生成的事件也不能被吞掉', async () => {
  const session = startFakeSession({ resumeFromSeq: () => 100 }); cleanups.push(() => session.stop());
  const link = createSessionLink({ url: session.url, hello: () => hello, replayCapacity: 20, idleTimeoutMs: 0, backoff: {}, onCommand: () => {}, logger: noopLogger });
  cleanups.push(() => link.close());
  link.emit({ kind: 'runnerState', state: 'ready' });
  link.emit({ kind: 'fileChanged', path: 'before-hello.ts' });
  link.start(); await link.whenReady();
  expect(link.emit({ kind: 'fileChanged', path: 'after-hello.ts' })).toBe(103);
  await session.waitFor(() => session.events().length === 3 ? true : undefined, 1000);
  expect(session.events().map((e) => e.seq)).toEqual([101, 102, 103]);
  expect(session.events()[1]?.event).toMatchObject({ path: 'before-hello.ts' });
});

test('旧 cs-session 未声明支持时不发送新增帧，原有事件及命令链继续工作', async () => {
  const session = startFakeSession({ nativeActivity: false }); cleanups.push(() => session.stop());
  const link = createSessionLink({ url: session.url, hello: () => hello, replayCapacity: 20, idleTimeoutMs: 0, backoff: {}, onCommand: () => {}, logger: noopLogger });
  cleanups.push(() => link.close());
  const activity = { agentId: 'cli', terminalId: 'pty', runnerId: crypto.randomUUID(), eventId: crypto.randomUUID(), seq: 1, turnOrdinal: 0, signal: { source: 'opencode/1.18.29' as const, sourceEventId: 'ready', kind: 'source-ready' as const, occurredAt: new Date().toISOString(), nativeSessionId: null, turnId: null } };
  link.emit({ kind: 'nativeActivity', activity });
  link.start(); await link.whenReady();
  link.emit({ kind: 'nativeActivity', activity: { ...activity, seq: 2 } });
  link.emit({ kind: 'fileChanged', path: 'compatible.ts' });
  await session.waitForEvent('fileChanged');
  expect(session.events().map((event) => event.event.kind)).toEqual(['fileChanged']);
  expect(session.events()[0]?.seq).toBe(3);
});

test('同一 Runner 重连仍使用原 seq 续传，不重复基移或改变事件身份', async () => {
  const resume = 10;
  const session = startFakeSession({ resumeFromSeq: () => resume }); cleanups.push(() => session.stop());
  const link = createSessionLink({ url: session.url, hello: () => hello, replayCapacity: 20, idleTimeoutMs: 0, backoff: { baseMs: 1, maxMs: 2 }, onCommand: () => {}, logger: noopLogger });
  cleanups.push(() => link.close());
  link.start(); await link.whenReady();
  expect(link.emit({ kind: 'runnerState', state: 'ready' })).toBe(11);
  await session.waitForEvent('runnerState');
  session.stop();
  expect(link.emit({ kind: 'fileChanged', path: 'next.ts' })).toBe(12);
  const next = startFakeSession({ port: session.port, resumeFromSeq: () => 11 });
  cleanups.push(() => next.stop());
  await next.waitForEvent('fileChanged');
  expect(next.events().map((e) => e.seq)).toEqual([12]);
  expect(link.emit({ kind: 'fileChanged', path: 'after-reconnect.ts' })).toBe(13);
  await next.waitForEvent('fileChanged', (e) => e.path === 'after-reconnect.ts');
  expect(next.events().map((e) => e.seq)).toEqual([12, 13]);
});

test('终端高频输出不能挤掉断线期间的原生状态；合并重放按 seq 去重排序', async () => {
  const session = startFakeSession({ resumeFromSeq: () => 100 }); cleanups.push(() => session.stop());
  const link = createSessionLink({ url: session.url, hello: () => hello, replayCapacity: 2, idleTimeoutMs: 0, backoff: {}, onCommand: () => {}, logger: noopLogger });
  cleanups.push(() => link.close());
  const activity = { agentId: 'cli', terminalId: 'pty', runnerId: crypto.randomUUID(), eventId: crypto.randomUUID(), seq: 1, turnOrdinal: 1, signal: { source: 'opencode/1.18.29' as const, sourceEventId: 'begin', kind: 'turn-started' as const, occurredAt: new Date().toISOString(), nativeSessionId: 'session', turnId: 'session:turn' } };
  link.emit({ kind: 'nativeActivity', activity });
  for (let i = 0; i < 10; i++) link.emit({ kind: 'terminalOutput', terminalId: 'pty', data: `output-${i}` });
  link.emit({ kind: 'nativeActivity', activity: { ...activity, seq: 2, eventId: crypto.randomUUID(), signal: { ...activity.signal, sourceEventId: 'end', kind: 'turn-completed' } } });
  link.start(); await link.whenReady();
  // 先等最后一帧；否则“等开始帧”本身在旧实现会一直超时。
  await session.waitFor(() => session.events().some((event) => event.seq === 112) ? true : undefined, 1000);
  expect(session.events().map((event) => event.seq)).toEqual([101, 111, 112]);
  expect(session.eventsOf('nativeActivity').map((event) => event.event.activity.signal.kind)).toEqual(['turn-started', 'turn-completed']);
  expect(session.eventsOf('nativeActivity')[0]?.event.activity.eventId).toBe(activity.eventId);
});
