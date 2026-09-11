import { describe, expect, test } from 'bun:test';
import type { FetchLike } from './events/eventsClient';
import { INGRESS_PATH, createApp } from './main';

const quiet = (): void => {};
const SECRET = 'webhook-s3cret';
const baseEnv = { CS_PROJECT: 'gitlab-event-producer', CS_SERVICE: 'gitlab-event-producer', CS_SLOT: 'preview', CS_ENVIRONMENT: 'production', CS_SERVICE_DOMAIN: 'svc.cs.internal', GITLAB_WEBHOOK_SECRET_TOKEN: SECRET };
const PUSH = { object_kind: 'push', ref: 'refs/heads/main', after: 'b'.repeat(40), checkout_sha: 'b'.repeat(40), project: { id: 7 }, commits: [{ timestamp: '2026-09-11T07:05:00Z' }] };

const hook = (payload: unknown, headers: Record<string, string> = {}): RequestInit => ({
  method: 'POST',
  headers: { 'content-type': 'application/json', 'x-gitlab-token': SECRET, 'x-gitlab-event': 'Push Hook', ...headers },
  body: JSON.stringify(payload),
});

const accepting = (body: unknown = { eventId: 'evt_' + '0'.repeat(31) + '1', deduplicated: false, deliveries: 1 }): FetchLike =>
  async () => Response.json(body, { status: 202 });

describe('POST ' + INGRESS_PATH, () => {
  test('密钥不符或缺失一律 401，且不去碰 cs-events', async () => {
    let called = 0;
    const eventsFetch: FetchLike = async () => { called += 1; return Response.json({}, { status: 202 }); };
    const app = createApp({ env: baseEnv, eventsFetch, log: quiet });
    for (const headers of [{ 'x-gitlab-token': 'wrong' }, { 'x-gitlab-token': '' }]) {
      expect((await app.request(INGRESS_PATH, hook(PUSH, headers))).status).toBe(401);
    }
    const missing = await app.request(INGRESS_PATH, { method: 'POST', headers: { 'content-type': 'application/json', 'x-gitlab-event': 'Push Hook' }, body: '{}' });
    expect(missing.status).toBe(401);
    expect(called).toBe(0);
  });

  test('服务未配置密钥时也是 401', async () => {
    const { GITLAB_WEBHOOK_SECRET_TOKEN: _omitted, ...noSecret } = baseEnv;
    const res = await createApp({ env: noSecret, eventsFetch: accepting(), log: quiet }).request(INGRESS_PATH, hook(PUSH));
    expect(res.status).toBe(401);
  });

  test('受理后按 ProducedEvent 形状投给 cs-events，并回传回执', async () => {
    let seen: { url: string; body: Record<string, unknown>; headers: Headers } | null = null;
    const eventsFetch: FetchLike = async (input, init) => {
      seen = { url: input, body: JSON.parse(String(init?.body)) as Record<string, unknown>, headers: new Headers(init?.headers) };
      return Response.json({ eventId: 'evt_' + '0'.repeat(31) + '1', deduplicated: false, deliveries: 2 }, { status: 202 });
    };
    const traceId = 'f'.repeat(32);
    const res = await createApp({ env: baseEnv, eventsFetch, log: quiet })
      .request(INGRESS_PATH, hook(PUSH, { 'x-gitlab-event-uuid': 'uuid-1', 'x-cs-trace-id': traceId }));
    expect(res.status).toBe(202);
    expect(await res.json()).toEqual({ accepted: true, eventType: 'gitlab.push', eventId: 'evt_' + '0'.repeat(31) + '1', deduplicated: false, deliveries: 2 });
    const call = seen as unknown as { url: string; body: Record<string, unknown>; headers: Headers };
    expect(call.url).toBe('http://events.svc.cs.internal/v1/events/produce');
    expect(call.body).toEqual({ eventType: 'gitlab.push', dedupKey: 'gitlab.push|uuid:uuid-1', occurredAt: '2026-09-11T07:05:00.000Z', traceId, payload: PUSH });
    // 投递不带任何凭据：身份由网关按源 Pod IP 解析。
    expect(call.headers.has('authorization')).toBe(false);
    expect(call.headers.has('x-gitlab-token')).toBe(false);
    expect(call.headers.get('x-cs-trace-id')).toBe(traceId);
  });

  test('没有入站 traceId 时不带 traceId 字段，交给 cs-events 生成', async () => {
    let body: Record<string, unknown> = {};
    const eventsFetch: FetchLike = async (_input, init) => {
      body = JSON.parse(String(init?.body)) as Record<string, unknown>;
      return Response.json({ eventId: 'evt_1', deduplicated: false, deliveries: 0 }, { status: 202 });
    };
    // 形状不对的 traceId（不是 32 位十六进制）必须被丢弃，否则 cs-events 会整条校验失败。
    await createApp({ env: baseEnv, eventsFetch, log: quiet }).request(INGRESS_PATH, hook(PUSH, { 'x-cs-trace-id': 'not-a-trace-id' }));
    expect('traceId' in body).toBe(false);
  });

  test('去重命中时照样 202，并把 deduplicated 传回去', async () => {
    const res = await createApp({ env: baseEnv, eventsFetch: accepting({ eventId: 'evt_x', deduplicated: true, deliveries: 0 }), log: quiet })
      .request(INGRESS_PATH, hook(PUSH, { 'x-gitlab-event-uuid': 'uuid-1' }));
    expect(await res.json()).toMatchObject({ accepted: true, deduplicated: true, deliveries: 0 });
  });

  test('未登记的钩子回 202＋ignored，GitLab 无需重投', async () => {
    let called = 0;
    const eventsFetch: FetchLike = async () => { called += 1; return Response.json({}, { status: 202 }); };
    const res = await createApp({ env: baseEnv, eventsFetch, log: quiet }).request(INGRESS_PATH, hook({}, { 'x-gitlab-event': 'Wiki Page Hook' }));
    expect(res.status).toBe(202);
    expect(await res.json()).toMatchObject({ accepted: false, ignored: true });
    expect(called).toBe(0);
  });

  test('请求体不是 JSON 对象时 400', async () => {
    const app = createApp({ env: baseEnv, eventsFetch: accepting(), log: quiet });
    expect((await app.request(INGRESS_PATH, { method: 'POST', headers: { 'x-gitlab-token': SECRET, 'x-gitlab-event': 'Push Hook' }, body: '不是 JSON' })).status).toBe(400);
    expect((await app.request(INGRESS_PATH, hook([1, 2]))).status).toBe(400);
  });

  test('cs-events 不可用时回 5xx，由 GitLab 重投', async () => {
    const down: FetchLike = async () => { throw new Error('connect ECONNREFUSED'); };
    expect((await createApp({ env: baseEnv, eventsFetch: down, log: quiet }).request(INGRESS_PATH, hook(PUSH))).status).toBe(503);
    const busy: FetchLike = async () => Response.json({ error: 'unavailable', message: '稍后重试' }, { status: 503 });
    expect((await createApp({ env: baseEnv, eventsFetch: busy, log: quiet }).request(INGRESS_PATH, hook(PUSH))).status).toBe(503);
  });

  test('cs-events 不回应时按超时收口成 503，而不是挂到连接被重置', async () => {
    // 投递超时刻意小于 Bun.serve 默认的 10 秒空闲超时，卡住的投递才来得及变成一条 5xx。
    const hang: FetchLike = async (_input, init) => new Promise((_resolve, reject) => {
      init?.signal?.addEventListener('abort', () => reject(new Error('aborted')));
    });
    const res = await createApp({ env: baseEnv, eventsFetch: hang, produceTimeoutMs: 20, log: quiet }).request(INGRESS_PATH, hook(PUSH));
    expect(res.status).toBe(503);
    expect(((await res.json()) as { message: string }).message).toContain('超时');
  });

  test('cs-events 拒收（事件类型未登记）时回 502，绝不当作受理', async () => {
    const rejecting: FetchLike = async () => Response.json({ error: 'not_found', message: '事件类型 gitlab.push 不存在' }, { status: 404 });
    const res = await createApp({ env: baseEnv, eventsFetch: rejecting, log: quiet }).request(INGRESS_PATH, hook(PUSH));
    expect(res.status).toBe(502);
    expect(((await res.json()) as { message: string }).message).toContain('404');
  });

  test('没有 CS_SERVICE_DOMAIN 时回 503 而不是静默丢弃', async () => {
    const { CS_SERVICE_DOMAIN: _omitted, ...noDomain } = baseEnv;
    expect((await createApp({ env: noDomain, eventsFetch: accepting(), log: quiet }).request(INGRESS_PATH, hook(PUSH))).status).toBe(503);
  });
});

describe('GET /healthz 与 GET /', () => {
  test('健康检查返回 200', async () => {
    const res = await createApp({ env: baseEnv, log: quiet }).request('/healthz');
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ status: 'ok' });
  });

  test('自述状态说清身份与投递目标，且不泄露密钥', async () => {
    const res = await createApp({ env: baseEnv, log: quiet }).request('/');
    const body = (await res.json()) as Record<string, unknown>;
    expect(body).toMatchObject({
      producer: 'gitlab', slot: 'preview', environment: 'production',
      ingressPath: INGRESS_PATH, eventsBaseUrl: 'http://events.svc.cs.internal', webhookSecretConfigured: true,
    });
    expect(body.eventTypes).toContain('gitlab.push');
    expect(JSON.stringify(body)).not.toContain(SECRET);
  });

  test('本机覆盖 EVENTS_BASE_URL 优先于服务域推导', async () => {
    const res = await createApp({ env: { ...baseEnv, EVENTS_BASE_URL: 'http://localhost:8084/' }, log: quiet }).request('/');
    expect((await res.json()) as { eventsBaseUrl: string }).toMatchObject({ eventsBaseUrl: 'http://localhost:8084' });
  });
});
