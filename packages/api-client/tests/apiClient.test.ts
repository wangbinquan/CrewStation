import { describe, expect, test } from 'bun:test';
import type { FetchLike, TaskStreamFrame } from '../index';
import { ApiClientError, createApiClient, isApiClientError, kindForStatus, parseErrorEnvelope, parseTaskStreamFrame, taskStreamUrl } from '../index';

interface Captured {
  url: string;
  method: string;
  headers: Headers;
  body: string | undefined;
  credentials: string | undefined;
}

/** 记录请求并按脚本应答的假 fetch。 */
function fakeFetch(respond: (captured: Captured) => Response) {
  const calls: Captured[] = [];
  const fetchImpl: FetchLike = async (input, init) => {
    const captured: Captured = {
      url: typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url,
      method: init?.method ?? 'GET',
      headers: new Headers(init?.headers),
      body: typeof init?.body === 'string' ? init.body : undefined,
      credentials: init?.credentials,
    };
    calls.push(captured);
    return respond(captured);
  };
  return { calls, fetchImpl };
}

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json; charset=utf-8' } });

/** 断言调用失败并返回错误；调用成功时直接让测试失败，避免联合类型断言。 */
async function caught(call: () => Promise<unknown>): Promise<ApiClientError> {
  try {
    await call();
  } catch (error) {
    if (isApiClientError(error)) return error;
    throw error;
  }
  throw new Error('期望抛出 ApiClientError，但调用成功返回');
}

describe('createApiClient：请求形状', () => {
  test('调用链回放包含项目作用域，两个路径段独立编码', async () => {
    const { calls, fetchImpl } = fakeFetch(() => json(200, {}));
    const client = createApiClient({ fetch: fetchImpl });
    await client.observability.trace('project one', 'trace/two');
    expect(calls[0]).toMatchObject({ method: 'GET', url: '/v1/projects/project%20one/traces/trace%2Ftwo', body: undefined });
  });
  test('原生动态按游标取有界页，已读只提交目标 CLI 轮次和已读位置', async () => {
    const { calls, fetchImpl } = fakeFetch(() => json(200, {}));
    const client = createApiClient({ fetch: fetchImpl });
    await client.devSession.getAgentActivity('task one');
    await client.devSession.getAgentActivity('task one', { cursor: 18, limit: 30 });
    const read = { agentId: 'agent/1', turnId: 'turn 2', throughSeq: 35 };
    await client.devSession.readAgentActivity('task one', read);
    expect(calls.map((c) => [c.method, c.url])).toEqual([
      ['GET', '/v1/tasks/task%20one/agent-activity'], ['GET', '/v1/tasks/task%20one/agent-activity?cursor=18&limit=30'], ['POST', '/v1/tasks/task%20one/agent-activity/read'],
    ]);
    expect(JSON.parse(calls[2]!.body!)).toEqual(read);
    await client.devSession.getAgentActivity('task one', { unread: true, before: 18, limit: 30 });
    const query = new URL(calls[3]!.url, 'http://client.test').searchParams;
    expect(Object.fromEntries(query)).toEqual({ unread: 'true', before: '18', limit: '30' });
  });
  test('原生 CLI 的请求 ID 逐字保留，列表和显式结束使用独立资源路径', async () => {
    const { calls, fetchImpl } = fakeFetch(() => json(202, {}));
    const client = createApiClient({ fetch: fetchImpl });
    const input = { clientRequestId: crypto.randomUUID(), cols: 80, rows: 24, permission: 'edit' as const };
    await client.devSession.startNativeTerminal('task one', input);
    await client.devSession.listNativeTerminals('task one');
    await client.devSession.stopNativeTerminal('task one', 'agent/1');
    expect(calls.map((c) => [c.method, c.url])).toEqual([
      ['POST', '/v1/tasks/task%20one/agent-terminals'], ['GET', '/v1/tasks/task%20one/agent-terminals'], ['POST', '/v1/tasks/task%20one/agent-terminals/agent%2F1/stop'],
    ]);
    expect(JSON.parse(calls[0]!.body!)).toEqual(input);
  });
  test('工作树预检是独立 GET，释放携带用户确认的会话 ID', async () => {
    const { calls, fetchImpl } = fakeFetch(() => json(200, {}));
    const client = createApiClient({ fetch: fetchImpl });
    await client.devSession.workspaceStatus('prj_1');
    await client.devSession.release('prj_1', { expectedTaskId: 'tsk_1' });
    expect(calls[0]).toMatchObject({ url: '/v1/projects/prj_1/dev-session/workspace-status', method: 'GET' });
    expect(calls[1]).toMatchObject({ url: '/v1/projects/prj_1/dev-session?expectedTaskId=tsk_1', method: 'DELETE' });
  });
  test('GET /v1/me 同源、带 Cookie、accept json', async () => {
    const me = { id: `usr_${'0'.repeat(32)}`, name: 'a', email: 'a@x', isAdmin: false, memberships: [], demoIdentity: true };
    const { calls, fetchImpl } = fakeFetch(() => json(200, me));
    const client = createApiClient({ fetch: fetchImpl });
    const received: unknown = await client.me.get();
    expect(received).toEqual(me);
    expect(calls[0]?.url).toBe('/v1/me');
    expect(calls[0]?.method).toBe('GET');
    expect(calls[0]?.credentials).toBe('include');
    expect(calls[0]?.headers.get('accept')).toBe('application/json');
    expect(calls[0]?.body).toBeUndefined();
  });

  test('baseUrl 前缀、路径段编码与查询串', async () => {
    const { calls, fetchImpl } = fakeFetch(() => json(200, { items: [] }));
    const client = createApiClient({ baseUrl: 'http://cs-api:8080/', fetch: fetchImpl });
    await client.apiCatalog.listOperations({ serviceId: 'svc_1' });
    await client.apiCatalog.setOpenPolicy('gitlab:GET:/v1/projects/{id}', { openPolicy: 'targeted' });
    await client.devSession.release('prj_1', { force: true });
    await client.devSession.release('prj_1');
    expect(calls[0]?.url).toBe('http://cs-api:8080/v1/catalog/operations?serviceId=svc_1');
    expect(calls[1]?.url).toBe(`http://cs-api:8080/v1/catalog/operations/${encodeURIComponent('gitlab:GET:/v1/projects/{id}')}/policy`);
    expect(calls[1]?.method).toBe('PUT');
    expect(calls[2]?.url).toBe('http://cs-api:8080/v1/projects/prj_1/dev-session?force=true');
    expect(calls[2]?.method).toBe('DELETE');
    expect(calls[3]?.url).toBe('http://cs-api:8080/v1/projects/prj_1/dev-session');
  });

  test('JSON 请求体与 content-type；config.set 按路径补 env', async () => {
    const { calls, fetchImpl } = fakeFetch(() => json(200, { ok: true }));
    const client = createApiClient({ fetch: fetchImpl });
    await client.config.set('prj_1', 'production', { name: 'DB_URL', value: 'x', isSecret: true });
    await client.services.switchTraffic('svc_1', { toSlot: 'preview' });
    expect(calls[0]?.url).toBe('/v1/projects/prj_1/config/production');
    expect(calls[0]?.headers.get('content-type')).toBe('application/json');
    expect(JSON.parse(calls[0]?.body ?? '{}')).toEqual({ name: 'DB_URL', value: 'x', isSecret: true, env: 'production' });
    expect(calls[1]?.url).toBe('/v1/services/svc_1/traffic-switch');
    expect(JSON.parse(calls[1]?.body ?? '{}')).toEqual({ toSlot: 'preview' });
  });

  test('204 与空体解析为 undefined', async () => {
    const { fetchImpl } = fakeFetch(() => new Response(null, { status: 204 }));
    const client = createApiClient({ fetch: fetchImpl });
    expect(await client.devSession.touch('tsk_1')).toBeUndefined();
  });

  test('projects.list 的 kind 过滤拼成逗号分隔的查询参数，省略时不带（RFC-002）', async () => {
    const { calls, fetchImpl } = fakeFetch(() => json(200, { items: [] }));
    const client = createApiClient({ fetch: fetchImpl });
    await client.projects.list(['DigitalWorker']);
    await client.projects.list(['APIProxy', 'EventProducer']);
    await client.projects.list();
    expect(calls[0]?.url).toBe('/v1/projects?kind=DigitalWorker');
    expect(calls[1]?.url).toBe(`/v1/projects?kind=${encodeURIComponent('APIProxy,EventProducer')}`);
    expect(calls[2]?.url).toBe('/v1/projects');
  });

  test('额外请求头随每个请求发送', async () => {
    const { calls, fetchImpl } = fakeFetch(() => json(200, { items: [] }));
    const client = createApiClient({ fetch: fetchImpl, headers: { 'x-cs-cli-token': 't' } });
    await client.projects.list();
    expect(calls[0]?.headers.get('x-cs-cli-token')).toBe('t');
  });
});

describe('错误映射', () => {
  test('错误体 { error, message, details } → ApiClientError', async () => {
    const { fetchImpl } = fakeFetch(() => json(412, { error: 'precondition', message: '存在未提交的更改，请先提交', details: { uncommitted: ['a.ts'] } }));
    const client = createApiClient({ fetch: fetchImpl });
    const error = await caught(() => client.devSession.publish('prj_1', { branch: 'main' }));
    expect(error.kind).toBe('precondition');
    expect(error.status).toBe(412);
    expect(error.message).toBe('存在未提交的更改，请先提交');
    expect(error.details).toEqual({ uncommitted: ['a.ts'] });
  });

  test('非错误体的 401／502 按状态码推断', async () => {
    const html = (status: number) => new Response('<html>gateway</html>', { status, headers: { 'content-type': 'text/html' } });
    const unauthenticated = await caught(() => createApiClient({ fetch: fakeFetch(() => html(401)).fetchImpl }).me.get());
    expect(unauthenticated.kind).toBe('unauthenticated');
    expect(unauthenticated.status).toBe(401);
    const badGateway = await caught(() => createApiClient({ fetch: fakeFetch(() => html(502)).fetchImpl }).me.get());
    expect(badGateway.kind).toBe('internal');
    expect(badGateway.status).toBe(502);
    expect(badGateway.details).toEqual({ body: '<html>gateway</html>' });
  });

  test('未知 error 值按状态码替换；details 非对象时置空', () => {
    expect(parseErrorEnvelope(404, { error: 'weird', message: 'm', details: 'x' })).toEqual({ error: 'not_found', message: 'm', details: {} });
    expect(kindForStatus(418)).toBe('validation');
    expect(kindForStatus(500)).toBe('internal');
  });

  test('fetch 抛错 → status 0、kind unavailable、保留 cause', async () => {
    const cause = new TypeError('Failed to fetch');
    const fetchImpl: FetchLike = () => Promise.reject(cause);
    const error = await caught(() => createApiClient({ fetch: fetchImpl }).projects.list());
    expect(error).toBeInstanceOf(ApiClientError);
    expect(error.status).toBe(0);
    expect(error.kind).toBe('unavailable');
    expect(error.message).toBe('Failed to fetch');
    expect(error.cause).toBe(cause);
  });
});

describe('任务流', () => {
  test('taskStreamUrl：同源相对路径与 http→ws 改写', () => {
    expect(taskStreamUrl('', 'tsk_1', 0)).toBe('/v1/tasks/tsk_1/stream?sinceSeq=0');
    expect(taskStreamUrl('http://cs-api:8080', 'tsk_1', 42)).toBe('ws://cs-api:8080/v1/tasks/tsk_1/stream?sinceSeq=42');
    expect(taskStreamUrl('https://api.example.com/', 'tsk_1')).toBe('wss://api.example.com/v1/tasks/tsk_1/stream?sinceSeq=0');
    expect(createApiClient().stream.taskStreamUrl('tsk_1', 7)).toBe('/v1/tasks/tsk_1/stream?sinceSeq=7');
  });

  test('parseTaskStreamFrame 只接受四种帧', () => {
    const event: TaskStreamFrame = { type: 'event', seq: 3, at: '2026-09-11T00:00:00.000Z', event: { kind: 'terminalOutput', terminalId: 't1', data: 'x' } };
    expect(parseTaskStreamFrame(JSON.stringify(event))).toEqual(event);
    expect(parseTaskStreamFrame({ type: 'streamReady', connected: true, replayed: 2 })).toEqual({ type: 'streamReady', connected: true, replayed: 2 });
    expect(parseTaskStreamFrame({ type: 'result', id: 'c1', payload: { path: '.' } })).toEqual({ type: 'result', id: 'c1', payload: { path: '.' } });
    expect(parseTaskStreamFrame({ type: 'error', id: 'open', code: 'forbidden', message: 'no' })?.type).toBe('error');
    expect(parseTaskStreamFrame({ type: 'pong' })).toBeUndefined();
    expect(parseTaskStreamFrame('not json')).toBeUndefined();
    expect(parseTaskStreamFrame({ type: 'event', seq: 'x' })).toBeUndefined();
  });
});
