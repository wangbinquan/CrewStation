export const resourcesProjectId = '01a0bf5d-8f4b-7e1e-8dde-c9c2ae13ed34', resourcesServiceId = '01a0bf5d-8f4b-760b-86b6-0bb9f08a9eaa';
/** 一条已可调（默认开放）、一条需申请（定向开放）；ID 故意不出现在界面上。 */
export const resourceOperations = [
  { id: '01a0bf5d-8f4b-7a11-8000-00000000c0de', proxyId: '01a0bf5d-8f4b-7a11-8000-0000000000c1', proxy: 'crm', method: 'POST', path: '/customers/{id}', summary: '更新客户', openPolicy: 'default', granted: true },
  { id: '01a0bf5d-8f4b-7a11-8000-00000000b111', proxyId: '01a0bf5d-8f4b-7a11-8000-0000000000b1', proxy: 'billing', method: 'GET', path: '/invoices', summary: '列出账单', openPolicy: 'targeted', granted: false },
] as const;
/** gitlab 生产的三种类型：一个族（issue.open／issue.close）与一个单独的 push；source.changed 是已订阅的那条。 */
export const resourceEventTypes = [
  { id: '01a0bf5d-8f4b-780c-85dd-95f81e0fec71', name: 'source.changed', producerId: '01a0bf5d-8f4b-780c-85dd-00000000e0e0', state: 'active', eventType: 'source.changed', producer: 'source', producerProject: 'source-producer' },
  { id: '01a0bf5d-8f4b-780c-85dd-000000000001', name: 'gitlab.issue.open', producerId: '01a0bf5d-8f4b-780c-85dd-00000000e0e1', state: 'active', eventType: 'gitlab.issue.open', producer: 'gitlab', producerProject: 'gitlab-event-producer' },
  { id: '01a0bf5d-8f4b-780c-85dd-000000000002', name: 'gitlab.issue.close', producerId: '01a0bf5d-8f4b-780c-85dd-00000000e0e1', state: 'active', eventType: 'gitlab.issue.close', producer: 'gitlab', producerProject: 'gitlab-event-producer' },
  { id: '01a0bf5d-8f4b-780c-85dd-000000000003', name: 'gitlab.push', producerId: '01a0bf5d-8f4b-780c-85dd-00000000e0e1', state: 'active', eventType: 'gitlab.push', producer: 'gitlab', producerProject: 'gitlab-event-producer', schemaRef: 'schemas/push.json' },
  { id: '01a0bf5d-8f4b-780c-85dd-000000000004', name: 'gitlab.tag', producerId: '01a0bf5d-8f4b-780c-85dd-00000000e0e1', state: 'removed', eventType: 'gitlab.tag', producer: 'gitlab', producerProject: 'gitlab-event-producer' },
] as const;
const createdAt = '2026-09-20T01:00:00.000Z';
export function projectResourcesFixture(admin = false) {
  const state = { kind: admin ? 'APIProxy' : 'DigitalWorker', fail: '', invalid: false, noService: false };
  const calls: string[] = [];
  const subscription = { id: '01a0bf5d-8f4b-7b9c-8c07-a2ef94c840cd', eventTypeId: '01a0bf5d-8f4b-780c-85dd-95f81e0fec71', serviceId: resourcesServiceId, eventType: 'source.changed', handlerPath: '/on-source', state: 'active' };
  const capability = {
    service: { identity: 'demo/demo', slug: 'demo', namespace: 'cs-demo' },
    hosts: { prod: 'https://demo.test', preview: 'https://preview.demo.test', dev: 'https://dev.demo.test', service: 'https://svc.demo.test', platformApi: 'https://platform.test' },
    conventions: { identityHeaders: { user: 'X-User-Id' }, env: { api: 'CS_API_BASE' }, paths: { health: '/healthz' }, eventHeaders: { trace: 'X-Trace-Id' } },
    identityForwarding: { source: 'project', fields: ['userId'], headers: ['X-User-Id'], tokenClaims: ['sub'] },
    config: { development: ['APP_GREETING'], production: ['APP_TOKEN'] },
    data: [{ id: '01a0bf5d-8f4b-7ff9-8b6e-d534bae6d857', projectId: resourcesProjectId, kind: 'postgres', env: 'development', plan: 'db-small', state: 'ready', envVar: 'CS_DATABASE_URL', createdAt }],
    subscriptions: [subscription], operations: [],
    mcp: [{ name: 'platform-mcp', url: 'https://mcp.test' }], businessTaskApi: [{ method: 'POST', path: '/business-tasks', summary: 'Start a business task' }], generatedAt: createdAt,
  };
  globalThis.fetch = (async (raw) => {
    const path = new URL(String(raw), 'http://localhost').pathname; calls.push(path);
    if (state.fail && path.endsWith(`/${state.fail}`)) return Response.json({ error: 'unavailable', message: '本主题暂不可用' }, { status: 503 });
    if (path === '/v1/me') return Response.json({ id: 'user', name: '开发者', platformRole: (admin) ? 'admin' : 'developer', isAdmin: admin, memberships: [{ projectId: resourcesProjectId, role: 'developer' }] });
    if (path === `/v1/projects/${resourcesProjectId}`) return Response.json({ id: resourcesProjectId, ...(state.noService ? { state: 'provisioning' } : { serviceId: resourcesServiceId, state: 'active' }), name: '示例项目', slug: 'demo', namespace: 'cs-demo', kind: state.kind });
    if (path.endsWith('/capabilities')) return Response.json(state.invalid ? {} : capability);
    if (path.endsWith('/repository')) return Response.json({ serviceId: resourcesServiceId, pathWithNamespace: 'crew/demo', defaultBranch: 'main', state: 'ready', httpUrl: 'https://repo.test/crew/demo' });
    if (path.endsWith('/subscriptions')) return Response.json({ items: [subscription] });
    if (path === '/v1/catalog/operations') return Response.json({ items: resourceOperations });
    if (path === '/v1/catalog/event-types') return Response.json({ items: resourceEventTypes });
    if (path.endsWith('/dev-session')) return Response.json({ error: 'not_found', message: '请先创建开发会话' }, { status: 404 });
    return Response.json({ items: [] });
  }) as typeof fetch;
  return { state, calls };
}
