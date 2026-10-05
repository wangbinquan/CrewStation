import { expect, test } from 'bun:test';
import { symlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { consumerFixture } from '../consumerFixture';
import { createFilesystemMetricsHandler } from '../server';
import { createProcessOwnerClient } from './transport';
import type { ProcessOwnerRequest } from './protocol';

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
