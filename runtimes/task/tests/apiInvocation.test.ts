import { afterEach, expect, test } from 'bun:test';
import { createServer } from 'node:net';
import type { Socket } from 'node:net';
import { API_INVOCATION_BODY_BYTES, API_INVOCATION_TIMEOUT_MS, RunnerResultPayloads } from '@crewstation/contracts';
import type { RunnerApiInvocation } from '@crewstation/contracts';
import { createApiInvoker } from '../src/http/apiInvocation';
import { loadConfigFromEnv } from '../src/config';
import { startFakeSession } from './fakeSession';
import { startTestRunner, TEST_TASK_ID } from './testRunner';

const cleanups: Array<() => void | Promise<void>> = [];
afterEach(async () => { for (const cleanup of cleanups.splice(0).reverse()) await cleanup(); });
const input = { proxy: 'crm', method: 'POST' as const, path: '/items/a%20b', query: { q: ['one', 'two'] }, headers: { 'content-type': 'application/json', 'x-test': 'header-secret' }, body: '{"value":"body-secret"}' };

async function boot(fetcher: (request: Request) => Response | Promise<Response>, idleTimeout = 0) {
  const server = Bun.serve({ port: 0, idleTimeout, fetch: fetcher }); cleanups.push(() => { server.stop(true); });
  const session = startFakeSession(); cleanups.push(() => session.stop());
  const base = `http://127.0.0.1:${server.port}/api/`;
  const tr = await startTestRunner(session.url, { internalApiBase: base }); cleanups.push(() => tr.dispose());
  await tr.runner.whenConnected();
  return { session, tr, base };
}

test('真实 Runner WS → HTTP 保留路径、重复查询、方法和请求体；422 是实测响应且内容不进日志', async () => {
  const requests: object[] = [];
  const { session, tr } = await boot(async (request) => { requests.push({ url: request.url, method: request.method, body: await request.text(), header: request.headers.get('x-test') }); return new Response('{"problem":"invalid"}', { status: 422, headers: { 'x-result': 'response-secret' } }); });
  expect(session.hellos[0]?.capabilities.apiInvocations).toBe(1);
  const result = RunnerResultPayloads.invokeApi.parse(await session.call({ id: 'invoke-real', type: 'invokeApi', ...input }));
  expect(result).toMatchObject({ status: 422, body: '{"problem":"invalid"}', headers: { 'x-result': 'response-secret' }, truncated: false, headersTruncated: false, bodyTruncated: false });
  expect(result.durationMs).toBeGreaterThanOrEqual(0);
  expect(requests).toEqual([{ url: expect.stringContaining('/api/crm/items/a%20b?q=one&q=two'), method: 'POST', body: input.body, header: 'header-secret' }]);
  expect(tr.logLines.join('\n')).not.toMatch(/body-secret|header-secret|response-secret/);
});

test('重定向如实返回，不二次访问；响应体和头各自截断，不冒充完整内容', async () => {
  const requested: string[] = [];
  const { session } = await boot((request) => {
    const path = new URL(request.url).pathname; requested.push(path);
    if (path.endsWith('/redirect')) return new Response('', { status: 302, headers: { location: '/must-not-follow' } });
    if (path.endsWith('/exact')) return new Response('a'.repeat(API_INVOCATION_BODY_BYTES));
    return new Response('中'.repeat(API_INVOCATION_BODY_BYTES), { headers: { 'x-large': 'a'.repeat(17_000) } });
  });
  const call = async (path: string) => RunnerResultPayloads.invokeApi.parse(await session.call({ ...input, id: path, type: 'invokeApi', path }));
  expect(await call('/redirect')).toMatchObject({ status: 302, headers: { location: '/must-not-follow' }, truncated: false });
  expect(requested).toEqual(['/api/crm/redirect']);
  const large = await call('/large');
  expect(large).toMatchObject({ truncated: true, bodyTruncated: true, headersTruncated: true });
  expect(new TextEncoder().encode(large.body).byteLength).toBeLessThanOrEqual(API_INVOCATION_BODY_BYTES);
  expect(large.body).not.toContain('�');
  expect(large.headers['x-large']).toBeUndefined();
  expect(await call('/exact')).toMatchObject({ truncated: false, bodyTruncated: false, body: 'a'.repeat(API_INVOCATION_BODY_BYTES) });
});

test('头已到达但响应流悬挂仍在固定 15 秒内中止；同时 CLI 命令继续响应', async () => {
  let requested = 0;
  const { session } = await boot(() => { requested++; return new Response(new ReadableStream({ start(controller) { controller.enqueue(new TextEncoder().encode('partial')); } })); });
  const started = performance.now();
  const hanging = session.call({ ...input, id: 'hanging', type: 'invokeApi' }, API_INVOCATION_TIMEOUT_MS + 3000);
  const outcome = hanging.then(() => undefined, (error: unknown) => error);
  expect(RunnerResultPayloads.listAgentTerminals.parse(await session.call({ id: 'cli-still-live', type: 'listAgentTerminals' })).terminals).toEqual([]);
  expect(await outcome).toMatchObject({ code: 'api_invocation_timeout', message: expect.stringContaining('可能已执行') });
  expect(performance.now() - started).toBeGreaterThanOrEqual(API_INVOCATION_TIMEOUT_MS);
  expect(requested).toBe(1);
}, 20_000);

test('未知目的地、平台头、重复头、超长查询和 GET body 不发请求；未配置通道不广告支持', async () => {
  let calls = 0;
  const { base } = await boot(() => { calls++; return new Response('unexpected'); });
  const invoker = createApiInvoker(base);
  const variants: Array<Partial<RunnerApiInvocation>> = [{ path: '//other.invalid' }, { path: '/items/../other' }, { headers: { Host: 'other.invalid' } }, { headers: { 'X-Test': 'a', 'x-test': 'b' } }, { query: { q: '中'.repeat(2000) } }, { method: 'GET' }];
  for (const changed of variants) await expect(invoker.invoke({ ...input, ...changed })).rejects.toMatchObject({ code: 'api_invocation_invalid' });
  expect(calls).toBe(0);
  expect(createApiInvoker().enabled).toBe(false);
  expect(createApiInvoker('file:///api/').enabled).toBe(false);
  await expect(createApiInvoker().invoke(input)).rejects.toMatchObject({ code: 'api_invocations_unavailable' });
  const config = loadConfigFromEnv({ CS_TASK_ID: TEST_TASK_ID, CS_RUNNER_TOKEN: 'token', CS_SESSION_URL: 'ws://localhost/runner', CS_INTERNAL_API_BASE: base });
  expect(config.internalApiBase).toBe(base);
});

test('响应中途断线不重复 POST，也不把第二次请求拼成第一次的结果', async () => {
  let writes = 0;
  const sockets = new Set<Socket>();
  const server = createServer((socket) => {
    sockets.add(socket); socket.on('close', () => sockets.delete(socket));
    let pending = '';
    socket.on('data', (data) => {
      pending += data.toString();
      const end = pending.indexOf('\r\n\r\n');
      if (end < 0) return;
      const size = Number(/content-length: (\d+)/i.exec(pending)?.[1] ?? 0);
      if (Buffer.byteLength(pending) < end + 4 + size) return;
      if (pending.includes('/warmup')) socket.write('HTTP/1.1 200 OK\r\nContent-Length: 5\r\nConnection: keep-alive\r\n\r\nready');
      else { writes++; socket.end('HTTP/1.1 200 OK\r\nContent-Length: 100\r\n\r\npartial'); }
      pending = '';
    });
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  cleanups.push(() => { for (const socket of sockets) socket.destroy(); return new Promise<void>((resolve) => server.close(() => resolve())); });
  const address = server.address(); if (!address || typeof address === 'string') throw new Error('expected TCP address');
  const base = `http://127.0.0.1:${address.port}/api/`;
  await (await fetch(`${base}crm/warmup`)).text();
  // Bun 1.3.13 的默认连接复用曾在读流中断后悄悄再发 POST，出现 writes === 2。
  await expect(createApiInvoker(base).invoke(input)).rejects.toMatchObject({ code: 'api_invocation_failed' });
  expect(writes).toBe(1);
}, 20_000);
