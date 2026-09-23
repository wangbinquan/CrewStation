import { describe, expect, test } from 'bun:test';
import type { FetchLike } from '../index';
import { createApiClient, isApiClientError, retryAfterSeconds } from '../index';

const PROJECT = '01a0bf5d-8f4b-7c01-8e19-e226732a75a4';
const RESOURCE = '01a0bf5d-8f4b-7c01-8e19-e226732a75a9';

function recorder(respond: () => Response = () => new Response(JSON.stringify({ items: [], counts: {}, cursor: 0 }), { status: 200, headers: { 'content-type': 'application/json' } })) {
  const calls: { url: string; method: string; body?: string }[] = [];
  const fetchImpl: FetchLike = async (input, init) => {
    calls.push({ url: String(input), method: init?.method ?? 'GET', ...(typeof init?.body === 'string' ? { body: init.body } : {}) });
    return respond();
  };
  return { calls, fetchImpl };
}

async function failure(call: () => Promise<unknown>) {
  try { await call(); } catch (error) { if (isApiClientError(error)) return error; throw error; }
  throw new Error('expected failure');
}

describe('RFC-025 资源视图客户端', () => {
  test('项目视图、管理员视图、收编报告与可做操作走各自的路由', async () => {
    const { calls, fetchImpl } = recorder();
    const client = createApiClient({ baseUrl: 'https://console.example', fetch: fetchImpl });
    await client.resources.view(PROJECT, { kind: 'agent-execution', includeStopped: 'true' });
    await client.resources.adminView({ projectId: PROJECT as never });
    await client.resources.adoptionReport();
    await client.resources.act(RESOURCE, 'release', { expectedVersion: 3 });
    expect(calls.map((c) => `${c.method} ${c.url}`)).toEqual([
      `GET https://console.example/v1/projects/${PROJECT}/resources?kind=agent-execution&includeStopped=true`,
      `GET https://console.example/v1/admin/resources?projectId=${PROJECT}`,
      'GET https://console.example/v1/admin/resources/adoption-report',
      `POST https://console.example/v1/resources/${RESOURCE}/actions/release`,
    ]);
    expect(calls[3]?.body).toBe('{"expectedVersion":3}');
  });

  test('推送流地址：同源相对路径，续传游标与过滤条件走查询参数', () => {
    const client = createApiClient();
    expect(client.resources.streamUrl(PROJECT)).toBe(`/v1/projects/${PROJECT}/resources/stream`);
    expect(client.resources.streamUrl(PROJECT, { cursor: 42, kind: 'dev-workspace' })).toBe(`/v1/projects/${PROJECT}/resources/stream?cursor=42&kind=dev-workspace`);
    expect(client.resources.adminStreamUrl({ includeStopped: 'true' })).toBe('/v1/admin/resources/stream?includeStopped=true');
  });
});

describe('429：网关限流与平台额度不足分开', () => {
  test('不带平台错误体的 429 是 rate_limited，带上 Retry-After 的秒数', async () => {
    const { fetchImpl } = recorder(() => new Response('Too Many Requests', { status: 429, headers: { 'retry-after': '7' } }));
    const error = await failure(() => createApiClient({ fetch: fetchImpl }).resources.view(PROJECT));
    expect(error).toMatchObject({ kind: 'rate_limited', status: 429, details: { retryAfter: 7 }, message: '请求过于频繁，7 秒后再试' });
    const { fetchImpl: bare } = recorder(() => new Response('Too Many Requests', { status: 429 }));
    expect(await failure(() => createApiClient({ fetch: bare }).resources.view(PROJECT))).toMatchObject({ kind: 'rate_limited', details: {}, message: '请求过于频繁，请稍后再试' });
  });

  test('平台自己的额度不足（带 quota_exceeded 错误体）仍是 quota_exceeded', async () => {
    const { fetchImpl } = recorder(() => new Response(JSON.stringify({ error: 'quota_exceeded', message: '并发任务已达配额上限 2', details: { limit: 2 } }), { status: 429, headers: { 'content-type': 'application/json' } }));
    expect(await failure(() => createApiClient({ fetch: fetchImpl }).resources.view(PROJECT))).toMatchObject({ kind: 'quota_exceeded', details: { limit: 2 } });
  });

  test('Retry-After 可以是秒数或 HTTP 日期；认不出就当没有', () => {
    const now = Date.parse('2026-09-23T12:00:00Z');
    expect(retryAfterSeconds('12', now)).toBe(12);
    expect(retryAfterSeconds('Wed, 23 Sep 2026 12:00:30 GMT', now)).toBe(30);
    expect(retryAfterSeconds('Wed, 23 Sep 2026 11:00:00 GMT', now)).toBe(0);
    expect(retryAfterSeconds('soon', now)).toBeUndefined();
    expect(retryAfterSeconds(null, now)).toBeUndefined();
  });
});
