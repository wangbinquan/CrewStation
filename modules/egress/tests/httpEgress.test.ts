import { expect, test } from 'bun:test';
import { EGRESS_HTTP_REQUEST_BYTES, EGRESS_HTTP_RESPONSE_BYTES, ForwardEgressHttpRequestSchema } from '@crewstation/contracts';
import { fetchHttpEgress } from '../adapters/http-client/httpEgress';

test('实际 HTTP 出站保留方法、二进制、错误状态与业务头，不转发平台身份或自动跟随跳转', async () => {
  const calls: Array<{ path: string; method: string; body: number[]; headers: Headers }> = [];
  const server = Bun.serve({ port: 0, hostname: '127.0.0.1', fetch: async (req) => {
    calls.push({ path: new URL(req.url).pathname, method: req.method, body: [...new Uint8Array(await req.arrayBuffer())], headers: req.headers });
    return new Response(new Uint8Array([0, 255, 128]), { status: new URL(req.url).pathname === '/missing' ? 404 : 307, headers: { location: '/next', 'x-total': '7', 'content-type': 'application/octet-stream', 'set-cookie': 'private=value' } });
  } });
  try {
    const input = ForwardEgressHttpRequestSchema.parse({ url: `${server.url}write`, method: 'POST', bodyBase64: Buffer.from([1, 0, 255]).toString('base64'), headers: { 'private-token': 'upstream-only', 'x-cs-source-service': 'forged/source', connection: 'x-remove', 'x-remove': 'transport', 'x-cs-trace-id': 'trace-1' } });
    const response = await fetchHttpEgress().send(input);
    expect(response.status).toBe(307); expect(response.headers.get('location')).toBe('/next'); expect(response.headers.get('x-total')).toBe('7'); expect(response.headers.has('set-cookie')).toBe(false);
    expect([...new Uint8Array(await response.arrayBuffer())]).toEqual([0, 255, 128]);
    expect(calls).toHaveLength(1); expect(calls[0]).toMatchObject({ path: '/write', method: 'POST', body: [1, 0, 255] });
    expect(calls[0]!.headers.get('private-token')).toBe('upstream-only'); expect(calls[0]!.headers.has('x-cs-source-service')).toBe(false); expect(calls[0]!.headers.has('x-remove')).toBe(false); expect(calls[0]!.headers.get('x-cs-trace-id')).toBe('trace-1');
    const missing = await fetchHttpEgress().send({ ...input, method: 'GET', bodyBase64: undefined, url: `${server.url}missing` });
    expect(missing.status).toBe(404); expect([...new Uint8Array(await missing.arrayBuffer())]).toEqual([0, 255, 128]);
  } finally { await server.stop(true); }
});

test('真实慢响应体在期限内终止，响应超量不会返回成功的截断 JSON', async () => {
  const server = Bun.serve({ port: 0, hostname: '127.0.0.1', fetch: (req) => new URL(req.url).pathname === '/large'
    ? new Response(new Uint8Array(EGRESS_HTTP_RESPONSE_BYTES + 1))
    : new URL(req.url).pathname === '/headers' ? new Response('ok', { headers: { 'x-large': 'x'.repeat(32769) } })
    : new Response(new ReadableStream({ start(controller) { controller.enqueue(new Uint8Array([1])); } })) });
  try {
    const input = { method: 'GET' as const, headers: {}, timeoutMs: 100 };
    const start = performance.now(); await expect(fetchHttpEgress().send({ ...input, url: `${server.url}slow` })).rejects.toBeDefined();
    expect(performance.now() - start).toBeLessThan(1500);
    await expect(fetchHttpEgress().send({ ...input, timeoutMs: 8000, url: `${server.url}large` })).rejects.toThrow('exceeds limit');
    await expect(fetchHttpEgress().send({ ...input, timeoutMs: 8000, url: `${server.url}headers` })).rejects.toBeDefined();
  } finally { await server.stop(true); }
});

test('出站契约拒绝不合法目标、额外项目、超量请求及 GET 请求体', () => {
  const input = { url: 'https://company.example.com/api', method: 'POST', headers: {} };
  expect(ForwardEgressHttpRequestSchema.parse(input).timeoutMs).toBe(8000);
  for (const bad of [{ url: 'file:///etc/passwd' }, { url: 'https://user:password@company.example.com' }, { url: 'https://company.example.com/#fragment' }, { projectId: 'other' }, { bodyBase64: 'not base64' }, { method: 'GET', bodyBase64: btoa('body') }, { timeoutMs: 8001 }, { headers: { test: 'line\r\ninjected' } }, { bodyBase64: Buffer.alloc(EGRESS_HTTP_REQUEST_BYTES + 1).toString('base64') }]) {
    expect(ForwardEgressHttpRequestSchema.safeParse({ ...input, ...bad }).success).toBe(false);
  }
});
