import { expect, test } from 'bun:test';
import { PROBE_OBSERVATION_CONCURRENCY, createFilesystemMetricsHandler } from './server';

// AW RFC-370 / RFC-042 hosted acceptance (2026-10-19): on a busy node the storage measurement held the one-at-a-time
// probe for most of every minute, so a database restore's source sample and its Job environment got 409 almost every
// time. A request that never ends must not hold its lane forever either.
const token = 'original-probe-deadline-token-with-32-characters';
const post = (path: string, body: BodyInit) => new Request(`http://probe${path}`, { method: 'POST', headers: { authorization: `Bearer ${token}` }, body });
// A request body that never ends keeps its handler waiting.
const stalled = () => new ReadableStream({ start() {} });
const probe = () => createFilesystemMetricsHandler({ token, roots: { local: '/nonexistent-probe-root' }, requestDeadlineMs: 50 });

test('a measurement that never completes is ended by the deadline and frees the probe', async () => {
  const handler = probe(), held = handler(post('/measure', stalled()));
  expect((await handler(post('/measure', JSON.stringify({})))).status).toBe(409);
  const ended = await held;
  expect(ended.status).toBe(503);
  expect(await ended.json()).toEqual({ error: 'Measurement exceeded its deadline' });
  // The next measurement is served instead of finding the probe busy.
  expect((await handler(post('/measure', JSON.stringify({})))).status).toBe(400);
});

test('metadata observations are served while a measurement runs', async () => {
  const handler = probe(), measuring = handler(post('/measure', stalled()));
  expect((await handler(post('/source', JSON.stringify({})))).status).toBe(400);
  expect((await handler(post('/absence', JSON.stringify({})))).status).toBe(400);
  expect((await handler(post('/measure', JSON.stringify({})))).status).toBe(409);
  expect((await measuring).status).toBe(503);
});

test('observations have their own bound and never hold back a measurement', async () => {
  const handler = probe();
  const observing = Array.from({ length: PROBE_OBSERVATION_CONCURRENCY }, (_, index) => handler(post(index % 2 ? '/absence' : '/source', stalled())));
  const refused = await handler(post('/source', JSON.stringify({})));
  expect(refused.status).toBe(409);
  expect(await refused.json()).toEqual({ error: 'Too many observations are running' });
  expect((await handler(post('/measure', JSON.stringify({})))).status).toBe(400);
  for (const response of await Promise.all(observing)) expect(response.status).toBe(503);
  expect((await handler(post('/absence', JSON.stringify({})))).status).toBe(400);
});
