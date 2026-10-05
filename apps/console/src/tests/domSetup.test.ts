import { registeredBackendFetch } from './domSetup';
import { expect, test } from 'bun:test';
import { get } from 'node:http';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

test('DOM setup retains native responses for real HTTP servers in the shared test process', async () => {
  const server = Bun.serve({
    hostname: '127.0.0.1',
    port: 0,
    fetch: () => Response.json({ ready: true }, { status: 201 }),
  });
  try {
    const reply = await new Promise<{ status: number; body: string }>((resolve, reject) => {
      const request = get(`http://127.0.0.1:${server.port}/`, (response) => {
        let body = '';
        response.setEncoding('utf8');
        response.on('data', (chunk: string) => { body += chunk; });
        response.on('end', () => resolve({ status: response.statusCode ?? 0, body }));
        response.on('error', reject);
      });
      request.on('error', reject);
    });
    // DOM registration must not replace Response: Bun.serve rejects the DOM implementation.
    expect(reply).toEqual({ status: 201, body: '{"ready":true}' });
    const element = document.createElement('button');
    element.textContent = 'Ready';
    expect(element.textContent).toBe('Ready');
  } finally {
    await server.stop(true);
  }
});

test('DOM setup retains native request metadata and cancellable filesystem signals', async () => {
  const request = new Request('http://source/consumers', { method: 'POST', headers: { 'content-length': '32769' }, body: '{}' });
  // Happy DOM rewrites forbidden request headers and its signals cannot be passed to Bun filesystem I/O.
  expect(request.headers.get('content-length')).toBe('32769');
  const root = await mkdtemp(join(tmpdir(), 'cs-dom-native-io-')), path = join(root, 'metadata');
  try {
    await writeFile(path, 'original');
    expect(await readFile(path, { encoding: 'utf8', signal: AbortSignal.timeout(1000) })).toBe('original');
    const controller = new AbortController(); controller.abort(new Error('native cancellation'));
    await expect(readFile(path, { encoding: 'utf8', signal: controller.signal })).rejects.toThrow();
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('DOM setup retains the real WebSocket client and its authenticated upgrade headers', async () => {
  const server = Bun.serve<{ token: string | null }>({ hostname: '127.0.0.1', port: 0,
    fetch: (request, server) => server.upgrade(request, { data: { token: request.headers.get('x-native-upgrade') } }) ? undefined : new Response('upgrade required', { status: 400 }),
    websocket: { open: (socket) => { socket.send(JSON.stringify({ token: socket.data.token })); }, message: () => {} },
  });
  let socket: WebSocket | undefined;
  try {
    const reply = await new Promise<string>((resolve, reject) => {
      // Bun's native client supports upgrade headers used by the backend Session tests.
      socket = new WebSocket(`ws://127.0.0.1:${server.port}/`, { headers: { 'x-native-upgrade': 'original' } } as never);
      socket.onmessage = (message) => resolve(String(message.data)); socket.onerror = reject;
    });
    expect(JSON.parse(reply)).toEqual({ token: 'original' });
  } finally { socket?.close(); await server.stop(true); }
});

test('DOM setup retains native fetch for real backend POST requests in the shared process', async () => {
  const server = Bun.serve({ hostname: '127.0.0.1', port: 0,
    fetch: async (request) => request.method === 'POST' ? Response.json({ body: await request.json(), token: request.headers.get('x-original-source') })
      : new Response('POST required', { status: 405 }),
  });
  try {
    const reply = await registeredBackendFetch(`http://127.0.0.1:${server.port}/`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-original-source': 'original' }, body: '{"ready":true}' });
    expect(reply.status).toBe(200); expect(await reply.json()).toEqual({ body: { ready: true }, token: 'original' });
  } finally { await server.stop(true); }
});
