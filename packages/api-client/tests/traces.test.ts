import { describe, expect, test } from 'bun:test';
import type { FetchLike } from '../index';
import { createApiClient } from '../index';

/** 只记录请求地址与方法的假 fetch，一律回空对象。 */
function recorder() {
  const calls: Array<{ method: string; url: string }> = [];
  const fetchImpl: FetchLike = async (input, init) => {
    calls.push({ method: init?.method ?? 'GET', url: typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url });
    return new Response('{}', { status: 200, headers: { 'content-type': 'application/json' } });
  };
  return { calls, client: createApiClient({ fetch: fetchImpl }) };
}

describe('调用链客户端', () => {
  test('列表带项目作用域与筛选参数，未给的参数不出现在地址里', async () => {
    const { calls, client } = recorder();
    await client.traces.list('project one');
    await client.traces.list('project one', { source: 'event', status: 'failed', window: '24h', cursor: '2026-09-23T10:00:00.000Z~0123', limit: 20 });
    expect(calls[0]).toEqual({ method: 'GET', url: '/v1/projects/project%20one/traces' });
    const query = new URL(calls[1]!.url, 'http://client.test');
    expect(query.pathname).toBe('/v1/projects/project%20one/traces');
    expect(Object.fromEntries(query.searchParams)).toEqual({ source: 'event', status: 'failed', window: '24h', cursor: '2026-09-23T10:00:00.000Z~0123', limit: '20' });
  });

  test('回放与执行事件：每个路径段独立编码，事件按游标翻页', async () => {
    const { calls, client } = recorder();
    await client.traces.get('project one', 'trace/two');
    await client.traces.events('project one', 'trace/two', 'task three', { cursor: '42', limit: 100 });
    expect(calls.map((c) => [c.method, c.url])).toEqual([
      ['GET', '/v1/projects/project%20one/traces/trace%2Ftwo'],
      ['GET', '/v1/projects/project%20one/traces/trace%2Ftwo/executions/task%20three/events?cursor=42&limit=100'],
    ]);
  });
});
