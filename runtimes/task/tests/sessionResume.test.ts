import { afterEach, expect, test } from 'bun:test';
import type { RunnerHello, TaskId } from '@crewstation/contracts';
import { TASKRUNNER_PROTOCOL_VERSION } from '@crewstation/contracts';
import { noopLogger } from '@crewstation/kernel';
import { createSessionLink } from '../src/sessionLink';
import { startFakeSession } from './fakeSession';

const cleanups: Array<() => void> = [];
afterEach(() => { for (const fn of cleanups.splice(0).reverse()) fn(); });
const hello: RunnerHello = { type: 'hello', taskId: 'tsk_0123456789abcdef0123456789abcdef' as TaskId, protocolVersion: TASKRUNNER_PROTOCOL_VERSION, runnerToken: 'test', workdir: '/work', capabilities: { drivers: [], pty: false, preview: false } };

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
