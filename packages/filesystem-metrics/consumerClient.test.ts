import { expect, test } from 'bun:test';
import { symlink, writeFile } from 'node:fs/promises';
import { request } from 'node:http';
import { join } from 'node:path';
import { consumerFixture } from './consumerFixture';
import { createFileConsumerClient } from './consumerClient';
import { createFilesystemMetricsHandler } from './server';

const token = 'file-consumer-original-source-token-32-characters';
const source = { bootId: '12345678-1234-1234-1234-123456789abc', namespace: 'pid:[701]' };
// Real loopback transport remains independent of global fetch mocks from unrelated console tests.
const loopback = (input: URL, init: RequestInit) => new Promise<Response>((resolve, reject) => {
  init?.signal?.throwIfAborted();
  const req = request(new URL(String(input)), { method: init?.method, headers: Object.fromEntries(new Headers(init?.headers)), signal: init?.signal ?? undefined }, (response) => {
    const chunks: Buffer[] = []; response.on('data', (chunk) => chunks.push(Buffer.from(chunk))); response.on('error', reject);
    response.on('end', () => resolve(new Response(Buffer.concat(chunks), { status: response.statusCode ?? 500, headers: { 'content-length': String(Buffer.concat(chunks).length) } })));
  });
  req.on('error', reject); req.end(String(init?.body ?? ''));
});

test('consumer client uses authenticated real HTTP, preserves original references and retains changed-source blockers', () => consumerFixture(async (f) => {
  const path = await f.process('22'); await symlink(f.file, join(path, 'fd/7'));
  const server = Bun.serve({ hostname: '127.0.0.1', port: 0, fetch: createFilesystemMetricsHandler({ token, roots: {}, procRoot: f.root }) });
  try {
    const options = { baseUrl: `http://127.0.0.1:${server.port}`, token, fetch: loopback }, client = createFileConsumerClient(options);
    const captured = await client.capture([f.identity]); expect(captured.complete).toBe(true); expect(captured.consumers).toHaveLength(1);
    expect(await client.observe(source, [f.identity])).toEqual(captured);
    await writeFile(join(f.root, 'sys/kernel/random/boot_id'), '12345678-1234-1234-1234-123456789abd');
    const changed = await client.observe(source, [f.identity]); expect(changed.complete).toBe(false); expect(changed.blockers).toContainEqual({ code: 'source-changed' });
    await expect(createFileConsumerClient({ ...options, token: 'another-original-source-token-over-32-characters' }).capture([f.identity])).rejects.toThrow('HTTP 401');
    await expect(client.capture([f.identity], AbortSignal.abort())).rejects.toThrow();
  } finally { await server.stop(true); }
}));

test('consumer client rejects contradictory or unrelated evidence instead of accepting zero occupancy', async () => {
  const response = { version: 1, complete: true, ...source, consumers: [], blockers: [] };
  for (const body of [
    { ...response, namespace: 'pid:[another]' }, { ...response, namespace: 'pid:[702]' },
    { ...response, blockers: [{ code: 'process-unreadable', pid: 1 }] },
    { ...response, consumers: [{ pid: 1, tid: 1, startedTick: '1', kind: 'descriptor', device: '1', inode: '2' }] },
    { ...response, arbitrary: 'untrusted' },
  ]) {
    const client = createFileConsumerClient({ baseUrl: 'http://source', token, fetch: async () => Response.json(body) });
    await expect(client.observe(source, [])).rejects.toThrow();
  }
  const oversized = createFileConsumerClient({ baseUrl: 'http://source', token, fetch: async () => new Response('{}', { headers: { 'content-length': '8388609' } }) });
  await expect(oversized.capture([])).rejects.toThrow('oversized');
  const streamed = createFileConsumerClient({ baseUrl: 'http://source', token, fetch: async () => new Response(new ReadableStream({ start(controller) { controller.enqueue(new Uint8Array(8_388_609)); controller.close(); } })) });
  await expect(streamed.capture([])).rejects.toThrow('oversized');
  const empty = createFileConsumerClient({ baseUrl: 'http://source', token, fetch: async () => new Response(null) });
  await expect(empty.capture([])).rejects.toThrow('empty');
  for (const baseUrl of ['file:///source', 'http://user:private@source']) expect(() => createFileConsumerClient({ baseUrl, token })).toThrow('configuration');
  expect(() => createFileConsumerClient({ baseUrl: 'http://source', token: 'short' })).toThrow('configuration');
});
