import { expect, test } from 'bun:test';
import { createApp } from './createApp';
import { serve } from './serve';

test('large stream listener limits remain independent from ordinary API bodies', async () => {
  const app = createApp({ name: 'bounded-listeners' });
  app.post('/bytes', async (c) => {
    const reader = c.req.raw.body!.getReader(); let size = 0;
    try { for (;;) { const next = await reader.read(); if (next.done) break; size += next.value.length; } } finally { reader.releaseLock(); }
    return c.json({ size });
  });
  const small = serve(app, { port: 0, hostname: '127.0.0.1', maxRequestBodySize: 32 });
  const large = serve(app, { port: 0, hostname: '127.0.0.1', maxRequestBodySize: 256, idleTimeout: 65 });
  try {
    const send = (url: URL, size: number) => fetch(new URL('/bytes', url), { method: 'POST', body: new Uint8Array(size), proxy: '' });
    expect((await send(small.url, 128)).status).toBe(413);
    expect(await (await send(large.url, 128)).json()).toEqual({ size: 128 });
    expect((await send(large.url, 257)).status).toBe(413);
    expect((await fetch(new URL('/healthz', small.url), { proxy: '' })).status).toBe(200);
  } finally { await small.stop(true); await large.stop(true); }
});
