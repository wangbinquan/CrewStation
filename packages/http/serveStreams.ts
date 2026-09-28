import { createServer } from 'node:http';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { Readable } from 'node:stream';
import { once } from 'node:events';
import type { Socket } from 'node:net';
import type { Hono } from 'hono';
import { payloadTooLarge } from '@crewstation/kernel';
import type { AppEnv } from './identity';

interface StreamOptions { port: number; hostname?: string; maxRequestBodySize: number; idleTimeout: number; maxConcurrentRequests?: number }

/** The byte listener needs socket backpressure during asynchronous admission and slow downloads. */
export async function serveStreams(app: Hono<AppEnv>, options: StreamOptions) {
  const sockets = new Set<Socket>(); let active = 0;
  const server = createServer((incoming, outgoing) => {
    if (active >= (options.maxConcurrentRequests ?? 8)) { outgoing.writeHead(429, { 'retry-after': '5', connection: 'close' }); outgoing.end(); return; }
    active++;
    void handleStream(app, incoming, outgoing, options).finally(() => { active--; });
  });
  server.on('connection', (socket) => { sockets.add(socket); socket.once('close', () => sockets.delete(socket)); });
  server.requestTimeout = 0;
  server.setTimeout(options.idleTimeout * 1000, (socket) => socket.destroy());
  const hostname = options.hostname ?? '0.0.0.0';
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(options.port, hostname, () => { server.off('error', reject); resolve(); });
  });
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Stream listener has no TCP address');
  return { port: address.port, url: new URL(`http://${hostname.includes(':') ? `[${hostname}]` : hostname}:${address.port}`), stop: (force = false) => new Promise<void>((resolve, reject) => {
    if (force) for (const socket of sockets) socket.destroy();
    server.close((error) => error ? reject(error) : resolve()); server.closeIdleConnections();
  }) };
}

async function handleStream(app: Hono<AppEnv>, incoming: IncomingMessage, outgoing: ServerResponse, options: StreamOptions): Promise<void> {
  const abort = new AbortController(); let tooLarge = false;
  const disconnected = () => { if (!outgoing.writableFinished) abort.abort(new Error('Object client disconnected')); };
  outgoing.once('close', disconnected); incoming.once('aborted', disconnected);
  try {
    const length = incoming.headers['content-length'];
    if (length && Number(length) > options.maxRequestBodySize) { outgoing.writeHead(413, { connection: 'close' }); outgoing.end(); return; }
    const headers = new Headers();
    for (const [name, value] of Object.entries(incoming.headers)) {
      if (Array.isArray(value)) for (const item of value) headers.append(name, item);
      else if (value !== undefined) headers.set(name, value);
    }
    const hasBody = incoming.method !== 'GET' && incoming.method !== 'HEAD';
    let consumed = 0;
    const body = hasBody ? (Readable.toWeb(incoming) as unknown as ReadableStream<Uint8Array>).pipeThrough(new TransformStream<Uint8Array, Uint8Array>({ transform(chunk, controller) {
      consumed += chunk.byteLength;
      if (consumed > options.maxRequestBodySize) { tooLarge = true; throw payloadTooLarge('请求字节超过传输上限'); }
      controller.enqueue(chunk);
    } }), { preventCancel: true }) : undefined;
    const request = new Request(new URL(incoming.url ?? '/', 'http://localhost'), { method: incoming.method, headers, signal: abort.signal, ...(body ? { body, duplex: 'half' } : {}) });
    const response = await app.fetch(request);
    if (tooLarge) { await response.body?.cancel(); outgoing.writeHead(413, { connection: 'close' }); outgoing.end(); return; }
    outgoing.statusCode = response.status;
    response.headers.forEach((value, name) => { if (name !== 'set-cookie') outgoing.setHeader(name, value); });
    const cookies = response.headers.getSetCookie(); if (cookies.length) outgoing.setHeader('set-cookie', cookies);
    // Denied uploads must not be drained just to reuse a connection.
    if (hasBody && !incoming.complete) outgoing.setHeader('connection', 'close');
    if (incoming.method === 'HEAD') await response.body?.cancel();
    else if (response.body) await sendStream(response.body, outgoing, abort.signal);
    outgoing.end();
  } catch {
    if (outgoing.headersSent) outgoing.destroy();
    else if (!outgoing.destroyed) { outgoing.writeHead(tooLarge ? 413 : 500, { connection: 'close' }); outgoing.end(); }
  } finally { outgoing.off('close', disconnected); incoming.off('aborted', disconnected); }
}

async function sendStream(body: ReadableStream<Uint8Array>, outgoing: ServerResponse, signal: AbortSignal): Promise<void> {
  const reader = body.getReader();
  const cancel = () => { void reader.cancel(signal.reason).catch(() => undefined); };
  signal.addEventListener('abort', cancel, { once: true });
  try {
    for (;;) {
      signal.throwIfAborted();
      const next = await reader.read(); if (next.done) break;
      if (!outgoing.write(next.value)) await once(outgoing, 'drain', { signal });
    }
  } finally { signal.removeEventListener('abort', cancel); await reader.cancel().catch(() => undefined); reader.releaseLock(); }
}
