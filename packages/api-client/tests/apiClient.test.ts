import { describe, expect, test } from 'bun:test';
import type { ProjectId, SaveWorkspaceLayoutRequest, TaskId, UserId } from '@crewstation/contracts';
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
  test('申请分页保留真实服务端游标、项目和状态，不改旧全量调用', async () => {
    const f = fakeFetch(() => json(200, { items: [], nextCursor: 'cursor-next' })), client = createApiClient({ baseUrl: 'https://console.test', fetch: f.fetchImpl });
    const query = { projectId: '01a0bf5d-8f4b-7fc7-8b88-18362617594b' as ProjectId, state: 'pending' as const, limit: 5, cursor: 'opaque/value?x=1' };
    expect(await client.apiCatalog.listRequestPage(query)).toEqual({ items: [], nextCursor: 'cursor-next' });
    expect(f.calls.map((c) => new URL(c.url).pathname)).toEqual(['/v1/api-requests/page']);
    for (const call of f.calls) { expect(call.method).toBe('GET'); expect(Object.fromEntries(new URL(call.url).searchParams)).toEqual({ ...query, limit: '5' }); }
    await client.apiCatalog.listRequests();
    expect(f.calls.slice(1).map((c) => new URL(c.url).pathname)).toEqual(['/v1/api-requests']);
    // RFC-018：出站资源已删除，客户端上不该再冒出一个 egress 门面。
    expect('egress' in client).toBe(false);
  });
  test('有界项目页与摘要准确传递分页、筛选和详情对象', async () => {
    const f = fakeFetch(() => json(200, { items: [], nextCursor: 'next' })); const client = createApiClient({ fetch: f.fetchImpl });
    const filters = { q: '项目 a/b', state: 'failed' as const, kind: ['APIProxy', 'EventProducer'] as const, limit: 20, cursor: 'a+b/=c', ownerUserId: '01a0bf5d-8f4b-799e-8662-91273789253a' as UserId };
    expect(await client.projects.page({ ...filters, kind: [...filters.kind] })).toEqual({ items: [], nextCursor: 'next' });
    await client.capabilities.projectSummaries({ ...filters, kind: [...filters.kind] });
    await client.capabilities.projectSummary('project one');
    for (const [i, path] of ['/v1/projects/page', '/v1/workbench/project-summaries'].entries()) {
      const url = new URL(f.calls[i]!.url, 'http://test'); expect(url.pathname).toBe(path);
      expect(Object.fromEntries(url.searchParams)).toEqual({ ...filters, limit: '20', kind: 'APIProxy,EventProducer' });
      expect(f.calls[i]!.method).toBe('GET'); expect(f.calls[i]!.body).toBeUndefined();
    }
    expect(f.calls[2]!.url).toBe('/v1/workbench/project-summaries/project%20one');
  });
  test('API 试调只调用项目的结构化入口，固定会话和参数原样保留，有界且不重复发送', async () => {
    const requests: Array<{ url: string; init?: RequestInit }> = [];
    const fetchImpl: FetchLike = async (url, init) => { requests.push({ url: String(url), init }); return json(200, { taskId: 'fixed-task' }); };
    const input = { expectedTaskId: '01a0bf5d-8f4b-7e3b-8ee6-bf27a166622a' as TaskId, operationId: 'crm:POST:/items/{id}', pathParameters: { id: '1' }, query: { label: ['one', 'two'] }, headers: { 'content-type': 'application/json' }, body: '{"name":"test"}' };
    const client = createApiClient({ fetch: fetchImpl });
    const received: unknown = await client.devSession.invokeApi('project one', input);
    expect(received).toEqual({ taskId: 'fixed-task' });
    expect(requests).toHaveLength(1);
    expect(requests[0]).toMatchObject({ url: '/v1/projects/project%20one/dev-session/api-invocations', init: { method: 'POST', keepalive: false, redirect: 'error', signal: expect.any(AbortSignal) } });
    expect(JSON.parse(String(requests[0]!.init!.body))).toEqual(input);
  });
  test('个人布局的读写把调用方给的 signal 交给 fetch：布局存储据此给每次读写设上限，不给时照旧', async () => {
    const requests: Array<{ url: string; init?: RequestInit }> = [];
    const fetchImpl: FetchLike = async (url, init) => { requests.push({ url: String(url), init }); return json(200, { revision: 1, layout: null, updatedAt: null }); };
    const client = createApiClient({ fetch: fetchImpl }), controller = new AbortController();
    const input = { expectedRevision: 1, layout: {} } as unknown as SaveWorkspaceLayoutRequest;
    await client.devSession.getWorkspaceLayout('task one', { signal: controller.signal });
    await client.devSession.saveWorkspaceLayout('task one', input, { signal: controller.signal });
    await client.devSession.saveWorkspaceLayout('task one', input);
    expect(requests.map((request) => [request.url, request.init?.method, request.init?.signal])).toEqual([
      ['/v1/tasks/task%20one/workspace-layout', 'GET', controller.signal], ['/v1/tasks/task%20one/workspace-layout', 'PUT', controller.signal], ['/v1/tasks/task%20one/workspace-layout', 'PUT', undefined],
    ]);
  });
  test('告警只读项目作用域的列表端点；告警订阅的三个方法已随基线 D61 删除', async () => {
    const { calls, fetchImpl } = fakeFetch(() => json(200, { items: [] }));
    const client = createApiClient({ fetch: fetchImpl });
    await client.observability.alerts('project one');
    expect(calls.map((call) => [call.method, call.url])).toEqual([['GET', '/v1/projects/project%20one/alerts']]);
    for (const removed of ['alertSubscriptions', 'setAlertSubscription', 'removeAlertSubscription']) expect(removed in client.observability).toBe(false);
  });
  test('两个发布来源均保留确认 SHA，开发来源另保留会话 ID，仍调用各自真实端点', async () => {
    const { calls, fetchImpl } = fakeFetch(() => json(202, {}));
    const client = createApiClient({ fetch: fetchImpl });
    const input = { branch: 'main', expectedCommitSha: 'a'.repeat(40), expectedTaskId: '01a0bf5d-8f4b-780e-826f-c732652342f0' as TaskId };
    await client.devSession.publish('project one', input);
    await client.services.publish('service two', { branch: input.branch, expectedCommitSha: input.expectedCommitSha });
    expect(calls.map((call) => [call.method, call.url])).toEqual([['POST', '/v1/projects/project%20one/publish'], ['POST', '/v1/services/service%20two/releases']]);
    expect(JSON.parse(calls[0]!.body!)).toEqual(input);
    expect(JSON.parse(calls[1]!.body!)).toEqual({ branch: 'main', expectedCommitSha: input.expectedCommitSha });
  });

  test('创建向导从真实模板目录读取，模板与套餐选择原样发给创建接口', async () => {
    const { calls, fetchImpl } = fakeFetch(() => json(200, { items: [] }));
    const client = createApiClient({ fetch: fetchImpl });
    await client.catalog.listProjectTemplates();
    const input = { name: '财务助手', slug: 'finance', kind: 'DigitalWorker' as const, ownerUserId: '01a0bf5d-8f4b-799e-8662-91273789253a' as UserId,
      template: 'custom-template', plan: 'standard-large', maxConcurrentTasks: 7 };
    await client.projects.create(input);
    expect(calls.map((call) => [call.method, call.url])).toEqual([['GET', '/v1/catalog/project-templates'], ['POST', '/v1/projects']]);
    expect(JSON.parse(calls[1]!.body!)).toEqual(input);
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
    const me = { id: '01a0bf5d-8f4b-7622-8c1a-d607ceefa8df', name: 'a', email: 'a@x', isAdmin: false, memberships: [], authMethod: 'password' as const };
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

  test('JSON 请求体与 content-type；config.create 按路径补 env', async () => {
    const { calls, fetchImpl } = fakeFetch(() => json(200, { ok: true }));
    const client = createApiClient({ fetch: fetchImpl });
    await client.config.create('prj_1', 'production', { name: 'DB_URL', bindingName: 'DB_URL', value: 'x', isSecret: true });
    await client.services.switchTraffic('svc_1', { toSlot: 'preview' });
    expect(calls[0]?.url).toBe('/v1/projects/prj_1/config/production');
    expect(calls[0]?.headers.get('content-type')).toBe('application/json');
    expect(JSON.parse(calls[0]?.body ?? '{}')).toEqual({ name: 'DB_URL', bindingName: 'DB_URL', value: 'x', isSecret: true, env: 'production' });
    expect(calls[1]?.url).toBe('/v1/services/svc_1/traffic-switch');
    expect(JSON.parse(calls[1]?.body ?? '{}')).toEqual({ toSlot: 'preview' });
  });

  test('RFC-021：下线、推迟、重新部署、槽记录、维护三件套、平台设置各打到正确的方法与路径', async () => {
    const { calls, fetchImpl } = fakeFetch(() => json(200, { items: [] }));
    const client = createApiClient({ fetch: fetchImpl });
    await client.services.takeOffline('svc_1', { expectedReleaseId: 'rel_1' as never });
    await client.services.postponeOffline('svc_1', { expectedDeadline: '2026-09-26T00:00:00.000Z' });
    await client.services.redeploy('rel/1', { expectedStandbyReleaseId: null });
    await client.services.listSlotEvents('svc_1');
    await client.services.getMaintenance('svc_1');
    await client.services.setMaintenance('svc_1', { switches: { users: true, services: false, events: true }, allowUserIds: [], reason: '修数据', expectedRevision: 0 });
    await client.services.exitMaintenance('svc_1', { expectedRevision: 1 });
    await client.platformSettings.autoOffline();
    await client.platformSettings.setAutoOffline({ rollbackRetentionHours: 72, idleOfflineDays: 14, reminderLeadHours: 24, expectedRevision: 0 });
    expect(calls.map((c) => `${c.method} ${c.url}`)).toEqual([
      'POST /v1/services/svc_1/slots/preview/offline', 'POST /v1/services/svc_1/slots/preview/postpone', `POST /v1/releases/${encodeURIComponent('rel/1')}/redeploy`,
      'GET /v1/services/svc_1/slot-events', 'GET /v1/services/svc_1/maintenance', 'PUT /v1/services/svc_1/maintenance', 'POST /v1/services/svc_1/maintenance/exit',
      'GET /v1/admin/settings/auto-offline', 'PUT /v1/admin/settings/auto-offline',
    ]);
    expect(JSON.parse(calls[2]?.body ?? '{}')).toEqual({ expectedStandbyReleaseId: null });
    expect(JSON.parse(calls[6]?.body ?? '{}')).toEqual({ expectedRevision: 1 });
  });

  test('RFC-025 T10：限流的平台默认与项目覆盖各打到正确的方法与路径', async () => {
    const { calls, fetchImpl } = fakeFetch(() => json(200, {}));
    const client = createApiClient({ fetch: fetchImpl });
    const bucket = { average: 1, burst: 1 };
    const limits = { platformApi: { perUser: bucket, inFlightPerUser: 1 }, userDomain: { perUser: bucket, perHost: bucket }, serviceDomain: { perSource: bucket, perTarget: bucket } };
    await client.platformSettings.rateLimits();
    await client.platformSettings.setRateLimits({ ...limits, expectedRevision: 0 });
    await client.platformSettings.projectRateLimits('prj/1');
    await client.platformSettings.setProjectRateLimits('prj/1', { override: null, expectedRevision: 2 });
    expect(calls.map((c) => `${c.method} ${c.url}`)).toEqual([
      'GET /v1/admin/settings/rate-limits', 'PUT /v1/admin/settings/rate-limits',
      `GET /v1/admin/projects/${encodeURIComponent('prj/1')}/rate-limits`, `PUT /v1/admin/projects/${encodeURIComponent('prj/1')}/rate-limits`,
    ]);
    expect(JSON.parse(calls[3]?.body ?? '{}')).toEqual({ override: null, expectedRevision: 2 });
  });

  test('RFC-025：重新部署的统一预检是只读的 GET', async () => {
    const { calls, fetchImpl } = fakeFetch(() => json(200, { ok: false, reason: { code: 'manifest-outdated', message: '旧写法', hint: '发布新版本' } }));
    const client = createApiClient({ fetch: fetchImpl });
    expect(await client.services.redeployPrecheck('rel/1')).toEqual({ ok: false, reason: { code: 'manifest-outdated', message: '旧写法', hint: '发布新版本' } });
    expect(calls.map((c) => `${c.method} ${c.url}`)).toEqual([`GET /v1/releases/${encodeURIComponent('rel/1')}/redeploy-precheck`]);
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
