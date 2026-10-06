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

test('busy and changing process reads share one deadline and return only the actual complete consumer evidence', async () => {
  const retained = { pid: 22, tid: 22, startedTick: '1', kind: 'descriptor' as const, device: '1', inode: '2' };
  const complete = { version: 1 as const, complete: true, ...source, consumers: [retained], blockers: [] };
  const signals: AbortSignal[] = [], bodies: string[] = [];
  const client = createFileConsumerClient({ baseUrl: 'http://source', token, fetch: async (_url, init) => {
    signals.push(init.signal!); bodies.push(String(init.body));
    if (signals.length === 1) return Response.json({ error: 'A measurement is already running' }, { status: 409 });
    if (signals.length === 2) return Response.json({ ...complete, complete: false, blockers: [{ code: 'process-unreadable', pid: 77 }, { code: 'process-changed' }] });
    return Response.json(complete);
  } });
  // Live inventory was rejected when unrelated short-lived node processes exited during an otherwise valid read.
  expect(await client.observe(source, [{ device: '1', inode: '2' }])).toEqual(complete);
  expect(signals).toHaveLength(3); expect(new Set(signals).size).toBe(1); expect(new Set(bodies).size).toBe(1);
});

test('permanent unknown consumers, unrecognized conflicts and changed sources never become a zero proof', async () => {
  const complete = { version: 1, complete: true, ...source, consumers: [], blockers: [] };
  const blocked = { ...complete, complete: false, blockers: [{ code: 'process-unreadable', pid: 22 }] };
  let reads = 0;
  const unavailable = createFileConsumerClient({ baseUrl: 'http://source', token, timeoutMs: 50, fetch: async () => { reads++; return Response.json(blocked); } });
  await expect(unavailable.capture([])).rejects.toThrow(); expect(reads).toBe(1);
  const conflict = createFileConsumerClient({ baseUrl: 'http://source', token, fetch: async () => Response.json({ error: 'different conflict' }, { status: 409 }) });
  await expect(conflict.capture([])).rejects.toThrow('HTTP 409');
  const unreadableSource = createFileConsumerClient({ baseUrl: 'http://source', token, fetch: async () => Response.json({ ...blocked, blockers: [{ code: 'source-unreadable' }] }) });
  expect(await unreadableSource.capture([])).toMatchObject({ complete: false, blockers: [{ code: 'source-unreadable' }] });
  let sourceReads = 0;
  const replaced = createFileConsumerClient({ baseUrl: 'http://source', token, fetch: async () => {
    sourceReads++; return Response.json({ ...blocked, namespace: 'pid:[702]', blockers: [{ code: 'source-changed' }] });
  } });
  expect(await replaced.observe(source, [])).toMatchObject({ complete: false, blockers: [{ code: 'source-changed' }] }); expect(sourceReads).toBe(1);
});

test('a late complete reply cannot escape the original caller cancellation', async () => {
  const controller = new AbortController(), reason = new Error('original observation cancelled');
  const client = createFileConsumerClient({ baseUrl: 'http://source', token, fetch: async () => {
    controller.abort(reason);
    return Response.json({ version: 1, complete: true, ...source, consumers: [], blockers: [] });
  } });
  await expect(client.capture([], controller.signal)).rejects.toBe(reason);
});

test('a conflict with extra fields is rejected once and a stalled success body obeys the original timeout', async () => {
  let reads = 0;
  const conflict = createFileConsumerClient({ baseUrl: 'http://source', token, timeoutMs: 50, fetch: async () => {
    reads++; return Response.json({ error: 'A measurement is already running', changed: true }, { status: 409 });
  } });
  await expect(conflict.capture([])).rejects.toThrow('HTTP 409'); expect(reads).toBe(1);
  let cancelled = false;
  const stalled = createFileConsumerClient({ baseUrl: 'http://source', token, timeoutMs: 20, fetch: async () => new Response(new ReadableStream({ cancel() { cancelled = true; } })) });
  let guard: ReturnType<typeof setTimeout> | undefined;
  try {
    const result = await Promise.race([stalled.capture([]).catch((error: unknown) => error), new Promise((resolve) => { guard = setTimeout(() => resolve('deadline escaped'), 250); })]);
    expect(result).toBeInstanceOf(Error); expect(cancelled).toBe(true);
  } finally { clearTimeout(guard); }
});
