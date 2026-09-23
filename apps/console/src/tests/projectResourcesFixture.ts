export const resourcesProjectId = '01a0bf5d-8f4b-7e1e-8dde-c9c2ae13ed34', resourcesServiceId = '01a0bf5d-8f4b-760b-86b6-0bb9f08a9eaa';
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
    if (path.endsWith('/dev-session')) return Response.json({ error: 'not_found', message: '请先创建开发会话' }, { status: 404 });
    return Response.json({ items: [] });
  }) as typeof fetch;
  return { state, calls };
}
