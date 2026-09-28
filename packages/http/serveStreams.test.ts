import { expect, test } from 'bun:test';
import { connect } from 'node:net';
import { once } from 'node:events';
import { createApp } from './createApp';
import { serveStreams } from './serveStreams';

/** Exercise the real framing directly: an ambient HTTP proxy must not replace the server's 413. */
async function oversizedChunked(port: number): Promise<number> {
  const socket = connect(port, '127.0.0.1'), response = Promise.withResolvers<number>(); let head = '';
  socket.on('error', response.reject);
  socket.on('data', (chunk) => { head += chunk.toString(); if (head.includes('\r\n\r\n')) response.resolve(Number(/^HTTP\/1\.1 (\d+)/.exec(head)?.[1])); });
  try {
    await once(socket, 'connect');
    socket.write(`PUT /bytes HTTP/1.1\r\nHost: localhost\r\nConnection: close\r\nTransfer-Encoding: chunked\r\n\r\n200\r\n${'x'.repeat(512)}\r\n0\r\n\r\n`);
    return await response.promise;
  } finally { socket.destroy(); }
}

test('stream listener carries status and headers, enforces limits, and accepts an empty upload', async () => {
  const app = createApp({ name: 'stream-listener' });
  app.put('/bytes', async (c) => c.json({ size: (await c.req.arrayBuffer()).byteLength }, 202, { 'x-stream': 'yes' }));
  app.get('/head', () => new Response('body', { headers: { 'content-length': '4', 'set-cookie': 'one=1' } }));
  const server = await serveStreams(app, { port: 0, hostname: '127.0.0.1', maxRequestBodySize: 256, idleTimeout: 2 });
  try {
    const send = (size: number) => fetch(new URL('/bytes', server.url), { method: 'PUT', body: new Uint8Array(size), proxy: '' });
    const response = await send(128);
    expect(response.status).toBe(202); expect(response.headers.get('x-stream')).toBe('yes'); expect(await response.json()).toEqual({ size: 128 });
    expect(await (await send(0)).json()).toEqual({ size: 0 });
    expect((await send(257)).status).toBe(413);
    expect(await oversizedChunked(server.port)).toBe(413);
    const head = await fetch(new URL('/head', server.url), { method: 'HEAD', proxy: '' });
    expect(await head.text()).toBe(''); expect(head.headers.get('content-length')).toBe('4'); expect(head.headers.getSetCookie()).toEqual(['one=1']);
    expect((await fetch(new URL('/healthz', server.url), { proxy: '' })).status).toBe(200);
  } finally { await server.stop(true); }
});

test('asynchronous admission and a slow body reader do not combine a 64 MiB upload into a whole-object chunk', async () => {
  const app = createApp({ name: 'upload-backpressure' }), size = 64 * 1024 * 1024;
  app.put('/bytes', async (c) => {
    await Bun.sleep(100);
    const reader = c.req.raw.body!.getReader(); let read = 0, largest = 0;
    for (;;) { const next = await reader.read(); if (next.done) break; read += next.value.byteLength; largest = Math.max(largest, next.value.byteLength); await Bun.sleep(1); }
    return c.json({ read, largest });
  });
  const server = await serveStreams(app, { port: 0, hostname: '127.0.0.1', maxRequestBodySize: size, idleTimeout: 10 });
  try {
    let sent = 0;
    const body = new ReadableStream<Uint8Array>({ pull(c) { if (sent === size) { c.close(); return; } const chunk = new Uint8Array(64 * 1024); sent += chunk.byteLength; c.enqueue(chunk); } });
    const response = await fetch(new URL('/bytes', server.url), { method: 'PUT', body, headers: { 'content-length': String(size) }, proxy: '' });
    const result = await response.json() as { read: number; largest: number };
    expect(response.status).toBe(200); expect(result.read).toBe(size); expect(result.largest).toBeLessThanOrEqual(2 * 1024 * 1024);
  } finally { await server.stop(true); }
}, 15_000);

test('a stalled TCP client stops upstream pulls and disconnect cancels the source', async () => {
  const app = createApp({ name: 'download-backpressure' }), size = 128 * 1024 * 1024;
  let produced = 0; const cancelled = Promise.withResolvers<void>();
  app.get('/bytes', () => new Response(new ReadableStream<Uint8Array>({ pull(c) {
    if (produced === size) { c.close(); return; }
    const chunk = new Uint8Array(64 * 1024); produced += chunk.byteLength; c.enqueue(chunk);
  }, cancel() { cancelled.resolve(); } }), { headers: { 'content-length': String(size) } }));
  const server = await serveStreams(app, { port: 0, hostname: '127.0.0.1', maxRequestBodySize: size, idleTimeout: 5 });
  const socket = connect(server.port, '127.0.0.1');
  try {
    await once(socket, 'connect');
    const received = Promise.withResolvers<void>(); socket.once('data', () => { socket.pause(); received.resolve(); });
    socket.write('GET /bytes HTTP/1.1\r\nHost: localhost\r\n\r\n'); await received.promise; await Bun.sleep(100);
    const paused = produced; await Bun.sleep(100);
    expect(produced).toBeLessThan(size / 2); expect(produced - paused).toBeLessThan(2 * 1024 * 1024);
    socket.destroy(); await cancelled.promise; expect(produced).toBeLessThan(size);
  } finally { socket.destroy(); await server.stop(true); }
});

test('per-process admission rejects before consuming an excess body and releases its slot on completion', async () => {
  const app = createApp({ name: 'stream-concurrency' }), started = Promise.withResolvers<void>(), release = Promise.withResolvers<void>();
  let calls = 0;
  app.put('/bytes', async (c) => { calls++; started.resolve(); await release.promise; return c.text('accepted'); });
  const server = await serveStreams(app, { port: 0, hostname: '127.0.0.1', maxRequestBodySize: 1024, idleTimeout: 5, maxConcurrentRequests: 1 });
  const send = () => fetch(new URL('/bytes', server.url), { method: 'PUT', body: 'test', proxy: '' });
  try {
    const first = send(); await started.promise;
    const rejected = await send(); expect(rejected.status).toBe(429); expect(rejected.headers.get('retry-after')).toBe('5'); expect(calls).toBe(1);
    release.resolve(); expect(await (await first).text()).toBe('accepted');
    expect(await (await send()).text()).toBe('accepted'); expect(calls).toBe(2);
  } finally { release.resolve(); await server.stop(true); }
});
