import { describe, expect, test } from 'bun:test';
import { createHmac } from 'node:crypto';
import { createApp } from './main';
import type { AppOptions } from './main';
import { cases } from './github/webhookFixtures';

const secret = 'local-test-secret';
const env = { GITHUB_WEBHOOK_SECRET: secret, EVENTS_BASE_URL: 'http://events' };
const receipt = { eventId: '01a0bf5d-8f4b-7004-9cf7-0eb8bf66ffbc', deduplicated: false, deliveries: 1 };
function request(body: string, hook = 'push', extra: Record<string, string> = {}): Request {
  return new Request('http://producer/hooks/github', { method: 'POST', headers: { 'content-type': 'application/json', 'x-github-event': hook,
    'x-hub-signature-256': `sha256=${createHmac('sha256', secret).update(body).digest('hex')}`, ...extra }, body });
}
const fixture = (options: AppOptions = {}) => createApp({ env, log: () => {}, eventsFetch: async () => Response.json(receipt, { status: 202 }), ...options });

describe('GitHub webhook HTTP', () => {
  test('every event forwards the unmodified payload and waits for a durable receipt', async () => {
    for (const { hook, type, payload } of cases) {
      let received: unknown;
      const app = fixture({ eventsFetch: async (url, init) => {
        expect(url).toBe('http://events/v1/events/produce');
        expect(new Headers(init?.headers).get('x-cs-trace-id')).toBe('a'.repeat(32));
        received = JSON.parse(String(init?.body)); return Response.json(receipt);
      } });
      const response = await app.request(request(JSON.stringify(payload), hook, { 'x-cs-trace-id': 'a'.repeat(32), 'x-github-delivery': 'delivery-1' }));
      expect(response.status).toBe(202);
      expect(await response.json()).toMatchObject({ accepted: true, eventType: type, ...receipt });
      expect(received).toMatchObject({ payload, eventType: type, dedupKey: `${type}|delivery:delivery-1`, traceId: 'a'.repeat(32) });
    }
  });
  test('bad signature, missing secret, JSON and content type fail before producing; ping/unknown are not accepted events', async () => {
    let count = 0;
    const app = fixture({ eventsFetch: async () => { count++; return Response.json(receipt); } });
    expect((await app.request(request('{}', 'ping', { 'x-hub-signature-256': '' }))).status).toBe(401);
    expect((await fixture({ env: {} }).request(request('{}'))).status).toBe(401);
    for (const value of ['[1]', 'null', '{']) expect((await app.request(request(value))).status).toBe(400);
    expect((await app.request(request('{}', 'ping', { 'content-type': 'application/x-www-form-urlencoded' }))).status).toBe(415);
    expect(await (await app.request(request('{}', 'ping'))).json()).toEqual({ accepted: false, pong: true });
    expect(await (await app.request(request('{}', 'unknown'))).json()).toMatchObject({ accepted: false, ignored: true });
    expect((await app.request(request('{}', 'push'))).status).toBe(400);
    expect(count).toBe(0);
  });
  test('unavailable events, network failure, timeout, malformed receipt and non-2xx never acknowledge success', async () => {
    const req = () => request(JSON.stringify(cases[0]!.payload));
    expect((await fixture({ env: { GITHUB_WEBHOOK_SECRET: secret } }).request(req())).status).toBe(503);
    for (const body of [{}, { ...receipt, deliveries: -1 }, { ...receipt, deduplicated: undefined }, { ...receipt, eventId: '' }]) {
      expect((await fixture({ eventsFetch: async () => Response.json(body) }).request(req())).status).toBe(503);
    }
    expect((await fixture({ eventsFetch: async () => new Response('invalid json') }).request(req())).status).toBe(503);
    for (const status of [400, 403, 404, 500, 503]) {
      expect((await fixture({ eventsFetch: async () => new Response('', { status }) }).request(req())).status).toBe(status >= 500 ? 503 : 502);
    }
    expect((await fixture({ eventsFetch: async () => { throw new Error('network'); } }).request(req())).status).toBe(503);
    const timeout = fixture({ produceTimeoutMs: 5, eventsFetch: async (_url, init) => new Promise((_resolve, reject) => {
      init?.signal?.addEventListener('abort', () => reject(new Error('aborted')), { once: true });
    }) });
    expect((await timeout.request(req())).status).toBe(503);
  });
  test('redelivery receipt, optional trace, health and status', async () => {
    const app = fixture({ eventsFetch: async (_url, init) => {
      expect(JSON.parse(String(init?.body)).traceId).toBeUndefined();
      return Response.json({ ...receipt, deduplicated: true, deliveries: 0 });
    } });
    expect(await (await app.request(request(JSON.stringify(cases[0]!.payload), 'push', { 'x-cs-trace-id': 'invalid' }))).json()).toMatchObject({ accepted: true, deduplicated: true, deliveries: 0 });
    expect((await app.request('/healthz')).status).toBe(200);
    const status = await (await app.request('/')).text();
    expect(status).toContain('github'); expect(status).not.toContain(secret);
  });
});
