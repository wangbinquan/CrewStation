import { expect, test } from 'bun:test';
import { request } from 'node:http';
import { randomUUID } from 'node:crypto';
import { symlink, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { consumerFixture } from './consumerFixture';
import { createFilesystemMetricsHandler } from './server';
import { createNodeFileConsumerClient, NodeFileConsumerRequestSchema, nodeFileConsumerRequestDigest } from './nodeConsumerClient';

const token = 'bound-node-consumer-birth-token-1234567890';
const origin = { identity: 'a'.repeat(64), probeUid: randomUUID(), containerId: 'containerd://' + 'c'.repeat(64), imageId: 'probe@sha256:' + 'd'.repeat(64),
  nodeUid: randomUUID(), nodeName: 'node', bootId: '12345678-1234-1234-1234-123456789abc', namespace: 'pid:[701]' };
const loopback = (input: URL, init: RequestInit) => new Promise<Response>((resolve, reject) => {
  const req = request(input, { method: init.method, headers: Object.fromEntries(new Headers(init.headers)), signal: init.signal ?? undefined }, response => {
    const chunks: Buffer[] = []; response.on('data', chunk => chunks.push(Buffer.from(chunk))); response.on('error', reject);
    response.on('end', () => resolve(new Response(Buffer.concat(chunks), { status: response.statusCode ?? 500 })));
  }); req.on('error', reject); req.end(String(init.body));
});
test('private node client binds actual HTTP and whole-thread file birth evidence to the unchanged original probe', () => consumerFixture(async proc => {
  const process = await proc.process('22'); await symlink(proc.file, join(process, 'fd/8'));
  const actual = String((await stat(proc.file, { bigint: true })).birthtimeNs), identities = [{ ...proc.identity, birthtimeNs: actual }];
  const sdk = createFilesystemMetricsHandler({ token, roots: {}, procRoot: proc.root });
  const server = Bun.serve({ hostname: '127.0.0.1', port: 0, fetch: async req => {
    if (req.headers.get('authorization') !== 'Bearer ' + token) return new Response(null, { status: 401 });
    const input = NodeFileConsumerRequestSchema.parse(await req.json());
    const observed = await sdk(new Request('http://probe/consumers', { method: 'POST', headers: { authorization: 'Bearer ' + token },
      body: JSON.stringify({ mode: 'observe', source: { bootId: input.origin.bootId, namespace: input.origin.namespace }, identities: input.identities }) }));
    return Response.json({ originIdentity: input.origin.identity, identitiesDigest: nodeFileConsumerRequestDigest(input.identities), observation: await observed.json() });
  } });
  try {
    const client = createNodeFileConsumerClient({ baseUrl: 'http://127.0.0.1:' + server.port, token, fetch: loopback });
    expect((await client.observe({ origin, identities })).consumers).toHaveLength(1);
    expect((await client.observe({ origin, identities: [{ ...proc.identity, birthtimeNs: String(BigInt(actual) + 1n) }] })).consumers).toHaveLength(0);
    expect((await client.observe({ origin, identities: [{ ...proc.identity, birthtimeNs: String(BigInt(actual) + 1n) }, ...identities] })).consumers).toHaveLength(1);
    await expect(client.observe({ origin, identities }, AbortSignal.abort())).rejects.toThrow();
    await expect(createNodeFileConsumerClient({ baseUrl: 'http://127.0.0.1:' + server.port, token: 'wrong-node-consumer-token-1234567890123456', fetch: loopback }).observe({ origin, identities })).rejects.toThrow('HTTP 401');
  } finally { await server.stop(true); }
}));
test('a zero-looking reply cannot omit birth scope, change the host or include another file', async () => {
  const identities = [{ device: '1', inode: '2', birthtimeNs: '31' }], expected = { originIdentity: origin.identity, identitiesDigest: nodeFileConsumerRequestDigest(identities),
    observation: { version: 1, complete: true, bootId: origin.bootId, namespace: origin.namespace, consumers: [], blockers: [] } };
  for (const reply of [
    { ...expected, originIdentity: 'b'.repeat(64) }, { ...expected, identitiesDigest: nodeFileConsumerRequestDigest([{ device: '1', inode: '2' }]) },
    { ...expected, observation: { ...expected.observation, namespace: 'pid:[702]' } },
    { ...expected, observation: { ...expected.observation, bootId: randomUUID() } },
    { ...expected, observation: { ...expected.observation, consumers: [{ pid: 1, tid: 1, startedTick: '2', kind: 'descriptor', device: '9', inode: '2' }] } },
    { ...expected, observation: { ...expected.observation, blockers: [{ code: 'source-unreadable' }] } }, { ...expected, complete: true },
  ]) await expect(createNodeFileConsumerClient({ baseUrl: 'http://native', token, fetch: async () => Response.json(reply) }).observe({ origin, identities })).rejects.toThrow();
  for (const baseUrl of ['file:///native', 'http://user:secret@native', 'http://native/other', 'http://native?path=other']) expect(() => createNodeFileConsumerClient({ baseUrl, token })).toThrow('configuration');
  expect(() => createNodeFileConsumerClient({ baseUrl: 'http://native', token: 'short' })).toThrow('configuration');
  for (const response of [new Response('{}', { headers: { 'content-length': '8388609' } }), new Response(new Uint8Array(8_388_609)), new Response(null)])
    await expect(createNodeFileConsumerClient({ baseUrl: 'http://native', token, fetch: async () => response }).observe({ origin, identities })).rejects.toThrow();
});
test('process churn retries the same bound request, while unknown source and stalled bodies remain blocked', async () => {
  const identities = [{ device: '1', inode: '2', birthtimeNs: '31' }], expected = { originIdentity: origin.identity, identitiesDigest: nodeFileConsumerRequestDigest(identities),
    observation: { version: 1, complete: true, bootId: origin.bootId, namespace: origin.namespace, consumers: [], blockers: [] } };
  const signals: AbortSignal[] = [], bodies: string[] = [];
  const client = createNodeFileConsumerClient({ baseUrl: 'http://native', token, fetch: async (_url, init) => {
    signals.push(init.signal!); bodies.push(String(init.body));
    return Response.json(signals.length === 1 ? { ...expected, observation: { ...expected.observation, complete: false, blockers: [{ code: 'process-changed', pid: 22 }] } } : expected);
  } });
  expect((await client.observe({ origin, identities })).complete).toBe(true); expect(signals).toHaveLength(2); expect(new Set(signals).size).toBe(1); expect(new Set(bodies).size).toBe(1);
  const unknown = createNodeFileConsumerClient({ baseUrl: 'http://native', token, fetch: async () => Response.json({ ...expected, observation: { ...expected.observation, complete: false, blockers: [{ code: 'source-unreadable' }] } }) });
  expect((await unknown.observe({ origin, identities })).complete).toBe(false);
  let cancelled = false;
  const stalled = createNodeFileConsumerClient({ baseUrl: 'http://native', token, timeoutMs: 20, fetch: async () => new Response(new ReadableStream({ cancel() { cancelled = true; } })) });
  await expect(stalled.observe({ origin, identities })).rejects.toThrow(); expect(cancelled).toBe(true);
});
