import { expect, test } from 'bun:test';
import { symlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { consumerFixture } from '../consumerFixture';
import { createFilesystemMetricsHandler } from '../server';
import { createProcessOwnerClient } from './transport';
import type { ProcessOwnerRequest, ProcessOwnerResponse } from './protocol';

test('private native process transport binds the original complete host and refuses authentication, caller roots or substituted scope', () => consumerFixture(async f => {
  await symlink('cgroup:[901]', join(f.root, 'self/ns/cgroup'));
  const process = await f.process('22'), podUid = 'dfd71b84-39f1-4434-a2ed-09828378ef8a';
  await writeFile(join(process, 'cgroup'), '0::/../../kubepods/pod' + podUid + '/native\n');
  const token = 'original-native-source-'.repeat(3), owners = [{ key: 'original', podUid }];
  const handler = createFilesystemMetricsHandler({ token, roots: {}, procRoot: f.root });
  const fetcher = (url: URL, init: RequestInit) => handler(new Request(url, init));
  const client = createProcessOwnerClient({ baseUrl: 'http://original', token, fetch: fetcher }), actual = await client.observe({ owners });
  expect(actual.complete).toBe(true); expect(actual.owners[0]!.threads).toHaveLength(1); expect(actual.cgroupNamespace).toBe('cgroup:[901]');
  await expect(createProcessOwnerClient({ baseUrl: 'http://original', token: 'wrong'.repeat(9), fetch: fetcher }).observe({ owners })).rejects.toThrow('unavailable');
  expect((await handler(new Request('http://original/process-owners', { method: 'POST', headers: { authorization: 'Bearer ' + token }, body: JSON.stringify({ owners, root: '/another' }) }))).status).toBe(503);
  for (const change of [{ owners: [] }, { cgroupNamespace: 'cgroup:[902]' }, { complete: true, blockers: [{ code: 'process-unreadable' }] }]) {
    const invalid = createProcessOwnerClient({ baseUrl: 'http://original', token, fetch: async () => Response.json({ ...actual, ...change }) });
    await expect(invalid.observe({ owners, source: { bootId: actual.bootId, namespace: actual.namespace, cgroupNamespace: actual.cgroupNamespace } })).rejects.toThrow();
  }
  await expect(createProcessOwnerClient({ baseUrl: 'http://original', token, fetch: async () => new Response('{') }).observe({ owners })).rejects.toThrow();
}));

test('native process transport cancels incomplete response bodies and refuses oversized complete inventories', async () => {
  const owners: ProcessOwnerRequest['owners'] = [], token = 'original-native-source-'.repeat(3); let cancelled = false;
  const signal = AbortSignal.timeout(20), stream = new ReadableStream<Uint8Array>({ start(controller) { controller.enqueue(new TextEncoder().encode('{')); }, cancel() { cancelled = true; } });
  const client = createProcessOwnerClient({ baseUrl: 'http://original', token, fetch: async () => new Response(stream) });
  await expect(client.observe({ owners }, signal)).rejects.toThrow(); expect(cancelled).toBe(true);
  await expect(createProcessOwnerClient({ baseUrl: 'http://original', token, fetch: async () => new Response('{}', { headers: { 'content-length': '8388609' } }) }).observe({ owners })).rejects.toThrow('budget');
});

test('original native process reads retry only the probe measurement lock within the same deadline and owner scope', () => consumerFixture(async f => {
  await symlink('cgroup:[901]', join(f.root, 'self/ns/cgroup'));
  await writeFile(join(await f.process('22'), 'cgroup'), '0::/native\n');
  const token = 'original-native-source-'.repeat(3), owners: ProcessOwnerRequest['owners'] = [], signal = AbortSignal.timeout(1000);
  const handler = createFilesystemMetricsHandler({ token, roots: {}, procRoot: f.root }), signals: AbortSignal[] = [], requests: string[] = [];
  const client = createProcessOwnerClient({ baseUrl: 'http://original', token, fetch: async (url, init) => {
    signals.push(init.signal!); requests.push(String(init.body));
    return signals.length === 1 ? Response.json({ error: 'A measurement is already running' }, { status: 409 }) : handler(new Request(url, init));
  } });
  expect((await client.observe({ owners }, signal)).complete).toBe(true); expect(signals).toEqual([signal, signal]); expect(new Set(requests).size).toBe(1);
  for (const error of [{ error: 'another conflict' }, { error: 'A measurement is already running', changed: true }]) {
    let reads = 0;
    await expect(createProcessOwnerClient({ baseUrl: 'http://original', token, fetch: async () => { reads++; return Response.json(error, { status: 409 }); } }).observe({ owners })).rejects.toThrow('unavailable');
    expect(reads).toBe(1);
  }
  let reads = 0;
  await expect(createProcessOwnerClient({ baseUrl: 'http://original', token, fetch: async () => { reads++; return Response.json({ error: 'A measurement is already running' }, { status: 409 }); } }).observe({ owners }, AbortSignal.timeout(10))).rejects.toThrow();
  expect(reads).toBe(1);
}));

test('original process reads wait for a complete snapshot after thread churn without changing the captured source or owner scope', async () => {
  const source = { bootId: '12345678-1234-1234-1234-123456789abc', namespace: 'pid:[701]', cgroupNamespace: 'cgroup:[901]' };
  const owners = [{ key: 'original', podUid: 'dfd71b84-39f1-4434-a2ed-09828378ef8a' }], signals: AbortSignal[] = [], requests: string[] = [];
  const complete: ProcessOwnerResponse = { version: 1, ...source, complete: true, owners: [{ key: 'original', threads: [{ pid: 22, tid: 22, startTicks: '1', identity: 'a'.repeat(64) }] }], blockers: [] };
  const signal = AbortSignal.timeout(1000);
  const client = createProcessOwnerClient({ baseUrl: 'http://original', token: 'original-native-source-'.repeat(3), fetch: async (_url, init) => {
    signals.push(init.signal!); requests.push(String(init.body));
    return Response.json(signals.length === 1 ? { ...complete, complete: false, blockers: [{ code: 'process-unreadable', pid: 77 }, { code: 'process-changed' }] } : complete);
  } });
  // A live original-node scan can be incomplete while unrelated short-lived threads exit.
  expect(await client.observe({ owners, source }, signal)).toEqual(complete);
  expect(signals).toEqual([signal, signal]); expect(new Set(requests).size).toBe(1);
});

test('process snapshot waiting never retries unknown sources, substituted owners or changed captured birth', async () => {
  const source = { bootId: '12345678-1234-1234-1234-123456789abc', namespace: 'pid:[701]', cgroupNamespace: 'cgroup:[901]' };
  const owners = [{ key: 'original', podUid: 'dfd71b84-39f1-4434-a2ed-09828378ef8a' }];
  const incomplete: ProcessOwnerResponse = { version: 1, ...source, complete: false, owners: [{ key: 'original', threads: [] }], blockers: [{ code: 'process-changed' }] };
  for (const code of ['source-unreadable', 'source-changed'] as const) {
    let reads = 0; const blocked = { ...incomplete, blockers: [{ code }] };
    const client = createProcessOwnerClient({ baseUrl: 'http://original', token: 'original-native-source-'.repeat(3), fetch: async () => { reads++; return Response.json(blocked); } });
    expect(await client.observe({ owners, source })).toEqual(blocked); expect(reads).toBe(1);
  }
  for (const change of [{ namespace: 'pid:[702]' }, { bootId: 'efd71b84-39f1-4434-a2ed-09828378ef8a' }, { cgroupNamespace: 'cgroup:[902]' }, { owners: [{ key: 'another', threads: [] }] }]) {
    let reads = 0;
    const client = createProcessOwnerClient({ baseUrl: 'http://original', token: 'original-native-source-'.repeat(3), fetch: async () => { reads++; return Response.json({ ...incomplete, ...change }); } });
    await expect(client.observe({ owners, source })).rejects.toThrow(); expect(reads).toBe(1);
  }
  let captures = 0;
  const capture = createProcessOwnerClient({ baseUrl: 'http://original', token: 'original-native-source-'.repeat(3), fetch: async () => Response.json({ ...incomplete, namespace: ++captures === 1 ? source.namespace : 'pid:[702]' }) });
  await expect(capture.observe({ owners })).rejects.toThrow(); expect(captures).toBe(2);
});

test('permanently incomplete process snapshots and late replies obey the same caller deadline and cancellation', async () => {
  const source = { bootId: '12345678-1234-1234-1234-123456789abc', namespace: 'pid:[701]', cgroupNamespace: 'cgroup:[901]' };
  const response = { version: 1, ...source, complete: false, owners: [], blockers: [{ code: 'process-unreadable', pid: 22 }] };
  let reads = 0;
  const client = createProcessOwnerClient({ baseUrl: 'http://original', token: 'original-native-source-'.repeat(3), fetch: async () => { reads++; return Response.json(response); } });
  await expect(client.observe({ owners: [], source }, AbortSignal.timeout(50))).rejects.toThrow(); expect(reads).toBe(1);
  const controller = new AbortController(), reason = new Error('original node observation cancelled');
  const cancelled = createProcessOwnerClient({ baseUrl: 'http://original', token: 'original-native-source-'.repeat(3), fetch: async () => { controller.abort(reason); return Response.json({ ...response, complete: true, blockers: [] }); } });
  await expect(cancelled.observe({ owners: [], source }, controller.signal)).rejects.toBe(reason);
});
