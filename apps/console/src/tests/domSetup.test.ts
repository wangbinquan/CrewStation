import './domSetup';
import { expect, test } from 'bun:test';
import { get } from 'node:http';

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
