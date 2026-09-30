import { expect, test } from 'bun:test';
import type { TaskId } from '@crewstation/contracts';
import { createSessionClient } from './sessionClient';
const taskId = '01a0bf5d-8f4b-7001-8458-107366e7de39' as TaskId, other = '01a0bf5d-8f4b-7001-8458-107366e7de40' as TaskId;
const fetcher = (run: (url: string | URL | Request, init?: RequestInit) => Promise<Response>) => Object.assign(run, { preconnect: fetch.preconnect });
test('actual execution lookup uses GET and returns only a validated explicit absence', async () => {
  const requests: Array<{ url: string; init?: RequestInit }> = [];
  const client = createSessionClient('http://session', fetcher(async (url, init) => { requests.push({ url: String(url), init }); return Response.json({ version: 1, runtimeTaskId: taskId, kind: 'absent' }); }));
  expect(await client.lookupDevelopmentUsage(taskId)).toEqual({ version: 1, runtimeTaskId: taskId, kind: 'absent' });
  expect(requests[0]).toMatchObject({ url: `http://session/internal/tasks/${taskId}/development-usage/registration`, init: { method: 'GET', redirect: 'error', keepalive: false, signal: expect.any(AbortSignal) } });
  expect(requests[0]!.init!.body).toBeUndefined();
  await expect(client.lookupDevelopmentUsage('not-a-task' as TaskId)).rejects.toThrow(); expect(requests).toHaveLength(1);
});
test('404, 503, invalid JSON and transport errors never become absence or a numeric zero', async () => {
  for (const status of [404, 503]) {
    const client = createSessionClient('http://session', fetcher(async () => Response.json({ error: 'unavailable', message: 'lookup failed' }, { status })));
    await expect(client.lookupDevelopmentUsage(taskId)).rejects.toMatchObject({ kind: 'unavailable' });
  }
  const malformed = createSessionClient('http://session', fetcher(async () => new Response('not-json', { status: 200 })));
  await expect(malformed.lookupDevelopmentUsage(taskId)).rejects.toThrow();
  const offline = createSessionClient('http://session', fetcher(async () => { throw new DOMException('timeout', 'TimeoutError'); }));
  await expect(offline.lookupDevelopmentUsage(taskId)).rejects.toMatchObject({ name: 'TimeoutError' });
});
test('strict client refuses another execution and invented absence fields, versions or malformed registered values', async () => {
  for (const body of [
    { version: 1, runtimeTaskId: other, kind: 'absent' }, { version: 2, runtimeTaskId: taskId, kind: 'absent' },
    { version: 1, runtimeTaskId: taskId, kind: 'absent', complete: true, persistedThrough: 0 },
    { version: 1, runtimeTaskId: taskId, kind: 'registered', stored: {} }, { version: 1, runtimeTaskId: taskId, kind: 'absent', secret: 'should-not-exist' },
  ]) await expect(createSessionClient('http://session', fetcher(async () => Response.json(body))).lookupDevelopmentUsage(taskId)).rejects.toThrow();
});
