import { expect, test } from 'bun:test';
import { IDENTITY_HEADERS } from '@crewstation/contracts';
import { createApp, serve } from '@crewstation/http';
import { precondition } from '@crewstation/kernel';
import type { ProjectDeletionController } from '../api/deletion';
import { projectDeletionRoutes } from '../http/projectDeletionRoutes';

const admin = Bun.randomUUIDv7(), project = Bun.randomUUIDv7(), operation = Bun.randomUUIDv7();
const repair = { owner: 'gateway', key: 'legacy', originalDigest: 'a'.repeat(64), evidenceDigest: 'b'.repeat(64), decision: 'retain' };
const confirmation = { planId: Bun.randomUUIDv7(), requestKey: Bun.randomUUIDv7(), confirm: 'delete' };
const requests = [
  { method: 'GET', path: `/v1/projects/${project}/deletion-repairs` },
  { method: 'POST', path: `/v1/projects/${project}/deletion-repairs`, body: repair },
  { method: 'POST', path: `/v1/projects/${project}/deletion-plans`, body: {} },
  { method: 'POST', path: `/v1/projects/${project}/deletions`, body: confirmation },
  { method: 'POST', path: `/v1/project-deletions/${operation}/reconfirmation-plans`, body: {} },
  { method: 'POST', path: `/v1/project-deletions/${operation}/reconfirm`, body: confirmation },
];

function fixture(delay: number) {
  let calls = 0;
  const blocked = async () => { calls++; if (delay) await Bun.sleep(delay); throw precondition('The actual source remains blocked; no deletion was accepted'); };
  const api: ProjectDeletionController = {
    repairs: { inspect: blocked, confirm: blocked }, prepare: blocked, accept: blocked, read: blocked, find: blocked,
    retry: blocked, prepareReconfirmation: blocked, reconfirm: blocked, enqueue: blocked, advance: blocked, recover: blocked,
  };
  return { app: createApp({ name: 'deletion-connection-test' }).route('/', projectDeletionRoutes(api, async id => id === admin)), calls: () => calls };
}
const init = (request: typeof requests[number], user = admin) => ({ method: request.method, headers: { [IDENTITY_HEADERS.userId]: user, 'content-type': 'application/json', connection: 'close' },
  ...(request.body === undefined ? {} : { body: JSON.stringify(request.body) }), signal: AbortSignal.timeout(24000) });

test('actual deletion HTTP connections survive a complete owner check longer than the server idle limit, including blocked results', async () => {
  const f = fixture(18000), server = serve(f.app, { port: 0, hostname: '127.0.0.1', idleTimeout: 1 });
  try {
    // Bun's native idle timer ticks coarsely; exceed its tick rather than rely on a subsecond close deadline.
    // Production repair reads need 30+ seconds; the default 10-second idle timer previously reset their sockets.
    const results = await Promise.allSettled(requests.map(async request => {
      const response = await fetch(new URL(request.path, server.url), init(request));
      expect(response.status).toBe(412);
      expect(response.headers.get('cache-control')).toBe('no-store');
      expect(await response.json()).toMatchObject({ error: 'precondition' });
    }));
    expect(results.map(result => result.status === 'fulfilled' ? null : String(result.reason))).toEqual(requests.map(() => null));
    expect(f.calls()).toBe(requests.length);
  } finally { await server.stop(true); }
}, 30000);

test('only verified administrator long checks extend their response connection; ordinary reads and retries retain the default', async () => {
  const f = fixture(0), held: string[] = [], environment = { timeout: (request: Request, seconds: number) => { expect(seconds).toBe(0); held.push(request.method + ' ' + new URL(request.url).pathname); } };
  for (const request of requests) {
    expect((await f.app.request(request.path, init(request, Bun.randomUUIDv7()), environment)).status).toBe(403);
  }
  expect(held).toEqual([]); expect(f.calls()).toBe(0);
  for (const request of requests) expect((await f.app.request(request.path, init(request), environment)).status).toBe(412);
  expect(held).toEqual(requests.map(request => request.method + ' ' + request.path));
  for (const request of [{ method: 'GET', path: `/v1/project-deletions/${operation}` }, { method: 'POST', path: `/v1/project-deletions/${operation}/retry`, body: {} }]) {
    expect((await f.app.request(request.path, init(request), environment)).status).toBe(412);
  }
  expect(held).toHaveLength(requests.length);
});
