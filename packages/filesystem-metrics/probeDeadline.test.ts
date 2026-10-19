import { expect, test } from 'bun:test';
import { createFilesystemMetricsHandler } from './server';

// AW RFC-370 hosted acceptance (2026-10-19): one measurement whose promise never settled kept the single-flight probe
// busy for good; every later caller got 409, and an independent database restore could never sample its source.
const token = 'original-probe-deadline-token-with-32-characters';
const post = (path: string, body: BodyInit) => new Request(`http://probe${path}`, { method: 'POST', headers: { authorization: `Bearer ${token}` }, body });

test('a request that never completes is ended by the deadline and frees the probe', async () => {
  const handler = createFilesystemMetricsHandler({ token, roots: { local: '/nonexistent-probe-root' }, requestDeadlineMs: 50 });
  // A request body that never ends keeps its measurement waiting.
  const stalled = handler(post('/source', new ReadableStream({ start() {} })));
  const contended = await handler(post('/absence', JSON.stringify({})));
  expect(contended.status).toBe(409);
  const ended = await stalled;
  expect(ended.status).toBe(503);
  expect(await ended.json()).toEqual({ error: 'Measurement exceeded its deadline' });
  // The next request is served instead of finding the probe busy.
  const next = await handler(post('/absence', JSON.stringify({})));
  expect(next.status).toBe(400);
});
