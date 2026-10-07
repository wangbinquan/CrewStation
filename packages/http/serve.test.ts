import { expect, test } from 'bun:test';
import { request } from 'node:http';
import { createApp } from './createApp';
import { serve } from './serve';

// Use a fresh real connection: shared console mocks cannot validate listener limits.
const loopback = (url: URL, body?: Uint8Array) => new Promise<Response>((resolve, reject) => {
  const req = request(url, { method: body ? 'POST' : 'GET', agent: false,
    headers: body ? { 'content-length': String(body.byteLength) } : undefined }, (response) => {
    const chunks: Buffer[] = [];
    response.on('data', (chunk) => chunks.push(Buffer.from(chunk)));
    response.on('error', reject);
    response.on('end', () => resolve(new Response(Buffer.concat(chunks), { status: response.statusCode ?? 500 })));
  });
  req.on('error', reject); req.end(body);
});

test('large stream listener limits remain independent from ordinary API bodies', async () => {
  const app = createApp({ name: 'bounded-listeners' });
  app.post('/bytes', async (c) => {
    const reader = c.req.raw.body!.getReader(); let size = 0;
    try { for (;;) { const next = await reader.read(); if (next.done) break; size += next.value.length; } } finally { reader.releaseLock(); }
    return c.json({ size });
  });
  const small = serve(app, { port: 0, hostname: '127.0.0.1', maxRequestBodySize: 32 });
  const large = serve(app, { port: 0, hostname: '127.0.0.1', maxRequestBodySize: 256, idleTimeout: 65 });
  const previousFetch = globalThis.fetch; let mockedListenerCalls = 0;
  try {
    globalThis.fetch = Object.assign(async (input: Parameters<typeof fetch>[0], init?: Parameters<typeof fetch>[1]) => {
      const url = new URL(input instanceof Request ? input.url : String(input));
      if ([small.url.origin, large.url.origin].includes(url.origin)) {
        mockedListenerCalls++; return new Response('A fetch mock is not a listener response', { status: 503 });
      }
      return previousFetch(input, init);
    }, { preconnect: previousFetch.preconnect });
    const send = (url: URL, size: number) => loopback(new URL('/bytes', url), new Uint8Array(size));
    expect((await send(small.url, 128)).status).toBe(413);
    expect(await (await send(large.url, 128)).json()).toEqual({ size: 128 });
    expect((await send(large.url, 257)).status).toBe(413);
    expect((await loopback(new URL('/healthz', small.url))).status).toBe(200);
    expect(mockedListenerCalls).toBe(0);
  } finally { globalThis.fetch = previousFetch; await small.stop(true); await large.stop(true); }
});
