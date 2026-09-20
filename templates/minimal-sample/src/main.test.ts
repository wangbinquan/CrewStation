import { describe, expect, test } from 'bun:test';
import { EventStore } from './events/gitlabHandler';
import { createApp } from './main';
import type { FetchLike } from './platform/agentClient';

const quiet = (): void => {};
const baseEnv = { CS_SLOT: 'preview', CS_ENVIRONMENT: 'production', GREETING: '早上好' };
const json = (body: unknown, extra: Record<string, string> = {}): RequestInit => ({
  method: 'POST',
  headers: { 'content-type': 'application/json', ...extra },
  body: JSON.stringify(body),
});

describe('GET /', () => {
  test('无网关请求头时显示未识别状态', async () => {
    const res = await createApp({ env: baseEnv, log: quiet }).request('/');
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('text/html');
    const html = await res.text();
    expect(html).toContain('未识别到网关身份');
    expect(html).not.toContain('用户 ID');
  });

  test('有网关请求头时显示名称、ID 与邮箱，并转义 HTML', async () => {
    const res = await createApp({ env: baseEnv, log: quiet }).request('/', {
      headers: { 'x-cs-user-id': 'usr_1', 'x-cs-user-name': 'Ada <b>Lovelace</b>', 'x-cs-user-email': 'ada@example.com' },
    });
    const html = await res.text();
    expect(html).toContain('Ada &lt;b&gt;Lovelace&lt;/b&gt;');
    expect(html).not.toContain('<b>Lovelace</b>');
    expect(html).toContain('usr_1');
    expect(html).toContain('ada@example.com');
    expect(html).not.toContain('未识别到网关身份');
  });

  test('显示部署槽、环境与配置项 GREETING', async () => {
    const html = await (await createApp({ env: baseEnv, log: quiet }).request('/')).text();
    expect(html).toContain('preview');
    expect(html).toContain('production');
    expect(html).toContain('早上好');
  });
});

describe('POST /events/gitlab', () => {
  const delivery = {
    deliveryId: 'dlv_1',
    eventId: `evt_${'0'.repeat(31)}1`,
    eventType: 'gitlab.push',
    source: { producer: 'gitlab', project: 'gitlab-event-producer' },
    occurredAt: '2026-09-11T08:00:00.000Z',
    receivedAt: '2026-09-11T08:00:01.000Z',
    traceId: 'a'.repeat(32),
    attempt: 2,
    payload: { ref: 'refs/heads/main' },
  };

  test('接受投递返回 202，并在首页渲染类型、时间、投递 ID 与次数', async () => {
    const app = createApp({ env: baseEnv, log: quiet });
    const res = await app.request('/events/gitlab', json(delivery));
    expect(res.status).toBe(202);
    expect(await res.json()).toEqual({ accepted: true, deliveryId: 'dlv_1' });
    const html = await (await app.request('/')).text();
    expect(html).toContain('gitlab.push');
    expect(html).toContain('2026-09-11T08:00:00.000Z');
    expect(html).toContain('dlv_1');
    expect(html).toContain('<td>2</td>');
    expect(html).toContain('a'.repeat(32));
  });

  test('只保留最近 20 条，最新的在最前', async () => {
    const store = new EventStore();
    const app = createApp({ env: baseEnv, eventStore: store, log: quiet });
    for (let i = 0; i < 25; i++) await app.request('/events/gitlab', json({ ...delivery, deliveryId: `dlv_${i}` }));
    expect(store.list()).toHaveLength(20);
    expect(store.list()[0]?.deliveryId).toBe('dlv_24');
    expect(store.list()[19]?.deliveryId).toBe('dlv_5');
  });

  test('信封不合格返回 400 并说明原因', async () => {
    const res = await createApp({ env: baseEnv, log: quiet }).request('/events/gitlab', json({ eventType: 'gitlab.push' }));
    expect(res.status).toBe(400);
    expect((await res.json()) as { error: string }).toEqual({ error: '字段 deliveryId 缺失或不是非空字符串' });
    const notJson = await createApp({ env: baseEnv, log: quiet }).request('/events/gitlab', { method: 'POST', body: 'nope' });
    expect(notJson.status).toBe(400);
  });
});

describe('GET /healthz', () => {
  test('返回 200 与状态', async () => {
    const res = await createApp({ env: baseEnv, log: quiet }).request('/healthz');
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ status: 'ok' });
  });
});

describe('GET /api/hello', () => {
  test('回显网关注入的调用方服务身份与 GREETING', async () => {
    const res = await createApp({ env: baseEnv, log: quiet }).request('/api/hello', { headers: { 'x-cs-source-service': 'issue-bot/issue-bot' } });
    expect(await res.json()).toEqual({ message: '早上好，issue-bot/issue-bot！', caller: 'issue-bot/issue-bot' });
    const anonymous = await createApp({ env: {}, log: quiet }).request('/api/hello');
    expect(await anonymous.json()).toEqual({ message: '你好，未识别的调用方！', caller: null });
  });
});

describe('POST /chat', () => {
  const traceId = 'f'.repeat(32);
  const platformEnv = { ...baseEnv, CS_PLATFORM_API_URL: 'http://api.svc.cs.internal/' };

  test('未配置 CS_PLATFORM_API_URL 时返回可读错误', async () => {
    const res = await createApp({ env: baseEnv, log: quiet }).request('/chat', json({ prompt: '你好' }));
    expect(res.status).toBe(503);
    expect(((await res.json()) as { error: string }).error).toContain('CS_PLATFORM_API_URL');
  });

  test('空 prompt 返回 400', async () => {
    const res = await createApp({ env: platformEnv, log: quiet }).request('/chat', json({ prompt: '   ' }));
    expect(res.status).toBe(400);
  });

  test('按顺序调用平台 API、转发 traceId 并返回 Agent 输出', async () => {
    const calls: string[] = [];
    let polls = 0;
    const platformFetch: FetchLike = async (input, init) => {
      const url = new URL(input);
      const method = init?.method ?? 'GET';
      calls.push(`${method} ${url.pathname}`);
      expect(url.origin).toBe('http://api.svc.cs.internal');
      expect(new Headers(init?.headers).get('x-cs-trace-id')).toBe(traceId);
      expect(new Headers(init?.headers).has('authorization')).toBe(false);
      switch (`${method} ${url.pathname}`) {
        case 'POST /v2/business-tasks':
          expect(JSON.parse(String(init?.body))).toEqual({});
          return Response.json({ id: '01a0bf5d-8f4b-75a7-80d4-bd6f2b68d4bb', state: 'creating' });
        case 'POST /v2/business-tasks/01a0bf5d-8f4b-75a7-80d4-bd6f2b68d4bb/subtasks':
          expect(JSON.parse(String(init?.body))).toEqual({ kind: 'agent', name: 'chat', agentProfileId: '01a0bf5d-8f4b-7101-8000-000000000001', mode: 'oneshot', prompt: '你好' });
          return Response.json({ id: '01a0bf5d-8f4b-713a-8076-fce7d175418c', state: 'pending' });
        case 'GET /v2/business-tasks/01a0bf5d-8f4b-75a7-80d4-bd6f2b68d4bb/subtasks/01a0bf5d-8f4b-713a-8076-fce7d175418c':
          polls += 1;
          return Response.json({ id: '01a0bf5d-8f4b-713a-8076-fce7d175418c', state: polls < 3 ? 'running' : 'succeeded' });
        case 'GET /v2/business-tasks/01a0bf5d-8f4b-75a7-80d4-bd6f2b68d4bb/subtasks/01a0bf5d-8f4b-713a-8076-fce7d175418c/output':
          return new Response('echo: 你好', { headers: { 'content-type': 'text/plain; charset=utf-8' } });
        case 'POST /v2/business-tasks/01a0bf5d-8f4b-75a7-80d4-bd6f2b68d4bb/close':
          return Response.json({ id: '01a0bf5d-8f4b-75a7-80d4-bd6f2b68d4bb', state: 'closing' });
        default:
          return new Response('not found', { status: 404 });
      }
    };
    const app = createApp({ env: platformEnv, platformFetch, sleep: async () => {}, log: quiet });
    const res = await app.request('/chat', json({ prompt: '你好' }, { 'x-cs-trace-id': traceId }));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ text: 'echo: 你好', taskId: '01a0bf5d-8f4b-75a7-80d4-bd6f2b68d4bb', subtaskId: '01a0bf5d-8f4b-713a-8076-fce7d175418c' });
    expect(calls).toEqual([
      'POST /v2/business-tasks',
      'POST /v2/business-tasks/01a0bf5d-8f4b-75a7-80d4-bd6f2b68d4bb/subtasks',
      'GET /v2/business-tasks/01a0bf5d-8f4b-75a7-80d4-bd6f2b68d4bb/subtasks/01a0bf5d-8f4b-713a-8076-fce7d175418c',
      'GET /v2/business-tasks/01a0bf5d-8f4b-75a7-80d4-bd6f2b68d4bb/subtasks/01a0bf5d-8f4b-713a-8076-fce7d175418c',
      'GET /v2/business-tasks/01a0bf5d-8f4b-75a7-80d4-bd6f2b68d4bb/subtasks/01a0bf5d-8f4b-713a-8076-fce7d175418c',
      'GET /v2/business-tasks/01a0bf5d-8f4b-75a7-80d4-bd6f2b68d4bb/subtasks/01a0bf5d-8f4b-713a-8076-fce7d175418c/output',
      'POST /v2/business-tasks/01a0bf5d-8f4b-75a7-80d4-bd6f2b68d4bb/close',
    ]);
  });

  test('平台 API 出错时返回错误信封里的说明，并仍然关闭任务', async () => {
    const calls: string[] = [];
    const platformFetch: FetchLike = async (input, init) => {
      const path = new URL(input).pathname;
      calls.push(`${init?.method ?? 'GET'} ${path}`);
      if (path === '/v2/business-tasks') return Response.json({ id: '01a0bf5d-8f4b-7d9f-84c5-6e87dfc71be2' });
      if (path.endsWith('/subtasks')) return Response.json({ error: 'quota_exceeded', message: '并发任务配额已满', details: {} }, { status: 429 });
      return Response.json({ id: '01a0bf5d-8f4b-7d9f-84c5-6e87dfc71be2', state: 'closing' });
    };
    const res = await createApp({ env: platformEnv, platformFetch, sleep: async () => {}, log: quiet }).request('/chat', json({ prompt: '你好' }));
    expect(res.status).toBe(502);
    expect(((await res.json()) as { error: string }).error).toBe('提交 Agent 子任务失败：HTTP 429（quota_exceeded：并发任务配额已满）');
    expect(calls.at(-1)).toBe('POST /v2/business-tasks/01a0bf5d-8f4b-7d9f-84c5-6e87dfc71be2/close');
  });

  test('子任务失败时返回 502、失败说明与部分输出', async () => {
    const platformFetch: FetchLike = async (input) => {
      const path = new URL(input).pathname;
      if (path === '/v2/business-tasks') return Response.json({ id: '01a0bf5d-8f4b-7521-866c-4ee471cc7c69' });
      if (path.endsWith('/subtasks')) return Response.json({ id: '01a0bf5d-8f4b-7e46-80e1-43e31e1d43ca' });
      if (path.endsWith('/01a0bf5d-8f4b-7e46-80e1-43e31e1d43ca')) return Response.json({ id: '01a0bf5d-8f4b-7e46-80e1-43e31e1d43ca', state: 'failed', error: '模型不可用' });
      if (path.endsWith('/output')) return new Response('partial');
      return Response.json({});
    };
    const res = await createApp({ env: platformEnv, platformFetch, sleep: async () => {}, log: quiet }).request('/chat', json({ prompt: '你好' }));
    expect(res.status).toBe(502);
    expect(await res.json()).toEqual({ error: 'Agent 子任务失败：模型不可用', text: 'partial', taskId: '01a0bf5d-8f4b-7521-866c-4ee471cc7c69', subtaskId: '01a0bf5d-8f4b-7e46-80e1-43e31e1d43ca' });
  });
});
