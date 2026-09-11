import { describe, expect, test } from 'bun:test';
import type { FetchLike } from './proxy/forward';
import { DEFAULT_TIMEOUT_MS } from './proxy/forward';
import { SERVER_IDLE_TIMEOUT_SECONDS, createApp } from './main';

const quiet = (): void => {};
const TOKEN = 'glpat-s3cret';
const baseEnv = {
  CS_PROJECT: 'reference-api-proxy', CS_SERVICE: 'reference-api-proxy', CS_SLOT: 'prod', CS_ENVIRONMENT: 'production',
  GITLAB_BASE_URL: 'http://gitlab.test:8929/', GITLAB_TOKEN: TOKEN,
};

interface Seen { url: string; method: string; headers: Headers; body: string }

/** 记下代理发给上游的请求，并按 given 回应。 */
function recorder(given: () => Response): { calls: Seen[]; fetch: FetchLike } {
  const calls: Seen[] = [];
  const fetch: FetchLike = async (url, init) => {
    const body = init?.body === undefined || init.body === null ? '' : await new Response(init.body as BodyInit).text();
    calls.push({ url, method: init?.method ?? 'GET', headers: new Headers(init?.headers), body });
    return given();
  };
  return { calls, fetch };
}

describe('转发', () => {
  test('方法、路径、查询串原样带到上游，并在上游地址后补 /api', async () => {
    const rec = recorder(() => Response.json([{ id: 1 }]));
    const app = createApp({ env: baseEnv, upstreamFetch: rec.fetch, log: quiet });
    const res = await app.request('/v4/projects?per_page=5&search=demo', { headers: { accept: 'application/json' } });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual([{ id: 1 }]);
    expect(rec.calls[0]?.url).toBe('http://gitlab.test:8929/api/v4/projects?per_page=5&search=demo');
    expect(rec.calls[0]?.method).toBe('GET');
    expect(rec.calls[0]?.headers.get('accept')).toBe('application/json');
  });

  test('请求体原样带到上游', async () => {
    const rec = recorder(() => Response.json({ name: 'feature/a' }, { status: 201 }));
    const app = createApp({ env: baseEnv, upstreamFetch: rec.fetch, log: quiet });
    const res = await app.request('/v4/projects/7/repository/branches?branch=feature%2Fa&ref=main', {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ note: '保持原样' }),
    });
    expect(res.status).toBe(201);
    expect(rec.calls[0]?.method).toBe('POST');
    expect(rec.calls[0]?.url).toBe('http://gitlab.test:8929/api/v4/projects/7/repository/branches?branch=feature%2Fa&ref=main');
    expect(JSON.parse(rec.calls[0]?.body ?? '{}')).toEqual({ note: '保持原样' });
  });

  test('注入平台给的上游令牌，剥掉调用方自带的凭据与平台身份头', async () => {
    const rec = recorder(() => new Response('ok'));
    await createApp({ env: baseEnv, upstreamFetch: rec.fetch, log: quiet }).request('/v4/projects', {
      headers: { authorization: 'Bearer forged', 'private-token': 'forged', 'x-cs-source-service': 'issue-bot/issue-bot', 'x-cs-source-token': 'jwt' },
    });
    const headers = rec.calls[0]?.headers as Headers;
    expect(headers.get('private-token')).toBe(TOKEN);
    expect(headers.has('authorization')).toBe(false);
    expect(headers.has('x-cs-source-service')).toBe(false);
    expect(headers.has('x-cs-source-token')).toBe(false);
  });

  test('traceId 既透传给上游，也回显给调用方', async () => {
    const traceId = 'f'.repeat(32);
    const rec = recorder(() => new Response('ok'));
    const res = await createApp({ env: baseEnv, upstreamFetch: rec.fetch, log: quiet })
      .request('/v4/projects', { headers: { 'x-cs-trace-id': traceId } });
    expect(rec.calls[0]?.headers.get('x-cs-trace-id')).toBe(traceId);
    expect(res.headers.get('x-cs-trace-id')).toBe(traceId);
  });

  test('上游状态码与响应体原样回传，包括错误', async () => {
    const notFound = recorder(() => Response.json({ message: '404 Project Not Found' }, { status: 404 }));
    const res = await createApp({ env: baseEnv, upstreamFetch: notFound.fetch, log: quiet }).request('/v4/projects/999');
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ message: '404 Project Not Found' });
    // 上游认为没授权就回 401；代理不改判、不补充自己的判断。
    const denied = recorder(() => Response.json({ message: '401 Unauthorized' }, { status: 401 }));
    expect((await createApp({ env: baseEnv, upstreamFetch: denied.fetch, log: quiet }).request('/v4/projects')).status).toBe(401);
  });

  test('上游的分页头原样回传，content-encoding 不回传', async () => {
    const rec = recorder(() => new Response('[]', { headers: { 'x-total': '42', 'x-next-page': '2', 'content-encoding': 'gzip' } }));
    const res = await createApp({ env: baseEnv, upstreamFetch: rec.fetch, log: quiet }).request('/v4/projects');
    expect(res.headers.get('x-total')).toBe('42');
    expect(res.headers.get('x-next-page')).toBe('2');
    expect(res.headers.has('content-encoding')).toBe(false);
  });

  test('未配置上游地址时 503，且不发出任何请求', async () => {
    const { GITLAB_BASE_URL: _omitted, ...noUpstream } = baseEnv;
    const rec = recorder(() => new Response('ok'));
    const res = await createApp({ env: noUpstream, upstreamFetch: rec.fetch, log: quiet }).request('/v4/projects');
    expect(res.status).toBe(503);
    expect(rec.calls).toHaveLength(0);
  });

  test('上游连不上时 502，说明里不带令牌', async () => {
    const down: FetchLike = async () => { throw new Error('connect ECONNREFUSED 127.0.0.1:8929'); };
    const res = await createApp({ env: baseEnv, upstreamFetch: down, log: quiet }).request('/v4/projects');
    expect(res.status).toBe(502);
    const body = await res.text();
    expect(body).toContain('连接上游失败');
    expect(body).not.toContain(TOKEN);
  });

  test('上游不回应时按超时回 504；SERVER_IDLE_TIMEOUT_SECONDS 必须大于上游超时，否则调用方只会看到连接被重置', async () => {
    const hang: FetchLike = async (_input, init) => new Promise((_resolve, reject) => {
      init?.signal?.addEventListener('abort', () => reject(new Error('aborted')));
    });
    const res = await createApp({ env: baseEnv, upstreamFetch: hang, timeoutMs: 20, log: quiet }).request('/v4/projects');
    expect(res.status).toBe(504);
    expect(((await res.json()) as { message: string }).message).toContain('超时');
    expect(SERVER_IDLE_TIMEOUT_SECONDS * 1000).toBeGreaterThan(DEFAULT_TIMEOUT_MS);
  });

  test('没有上游令牌时照样转发：给不给由上游按匿名身份决定', async () => {
    const { GITLAB_TOKEN: _omitted, ...noToken } = baseEnv;
    const rec = recorder(() => Response.json({ message: '401 Unauthorized' }, { status: 401 }));
    const res = await createApp({ env: noToken, upstreamFetch: rec.fetch, log: quiet }).request('/v4/projects');
    expect(res.status).toBe(401);
    expect(rec.calls[0]?.headers.has('private-token')).toBe(false);
  });

  test('代理不做鉴权：没有任何请求头的调用也照转不误', async () => {
    const rec = recorder(() => new Response('ok'));
    expect((await createApp({ env: baseEnv, upstreamFetch: rec.fetch, log: quiet }).request('/v4/projects')).status).toBe(200);
    expect(rec.calls).toHaveLength(1);
  });
});

describe('GET /healthz 与 GET /', () => {
  test('健康检查不走转发', async () => {
    const rec = recorder(() => new Response('ok'));
    const res = await createApp({ env: baseEnv, upstreamFetch: rec.fetch, log: quiet }).request('/healthz');
    expect(await res.json()).toEqual({ status: 'ok' });
    expect(rec.calls).toHaveLength(0);
  });

  test('自述状态只说配没配，不回显地址之外的任何凭据', async () => {
    const res = await createApp({ env: baseEnv, log: quiet }).request('/');
    const body = (await res.json()) as Record<string, unknown>;
    expect(body).toMatchObject({ proxy: 'test-gitlab', slot: 'prod', upstreamConfigured: true, upstreamTokenConfigured: true });
    expect(JSON.stringify(body)).not.toContain(TOKEN);
  });
});
