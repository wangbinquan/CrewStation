export const resourcesProjectId = `prj_${'a'.repeat(32)}`, resourcesServiceId = `svc_${'b'.repeat(32)}`;
const createdAt = '2026-09-20T01:00:00.000Z';
export function projectResourcesFixture(admin = false) {
  const state = { kind: admin ? 'APIProxy' : 'DigitalWorker', fail: '', invalid: false };
  const calls: string[] = [];
  const subscription = { id: 'sub-source', serviceId: resourcesServiceId, eventType: 'source.changed', handlerPath: '/on-source', state: 'active' };
  const capability = {
    service: { identity: 'demo/demo', slug: 'demo', namespace: 'cs-demo' },
    hosts: { prod: 'https://demo.test', preview: 'https://preview.demo.test', dev: 'https://dev.demo.test', service: 'https://svc.demo.test', platformApi: 'https://platform.test' },
    conventions: { identityHeaders: { user: 'X-User-Id' }, env: { api: 'CS_API_BASE' }, paths: { health: '/healthz' }, eventHeaders: { trace: 'X-Trace-Id' } },
    identityForwarding: { source: 'project', fields: ['userId'], headers: ['X-User-Id'], tokenClaims: ['sub'] },
    config: { development: ['APP_GREETING'], production: ['APP_TOKEN'] },
    data: [{ id: 'db-source', projectId: resourcesProjectId, kind: 'postgres', env: 'development', plan: 'db-small', state: 'ready', envVar: 'CS_DATABASE_URL', createdAt }],
    subscriptions: [subscription], operations: [],
    mcp: [{ name: 'platform-mcp', url: 'https://mcp.test' }], businessTaskApi: [{ method: 'POST', path: '/business-tasks', summary: 'Start a business task' }], generatedAt: createdAt,
  };
  globalThis.fetch = (async (raw) => {
    const path = new URL(String(raw), 'http://localhost').pathname; calls.push(path);
    if (state.fail && path.endsWith(`/${state.fail}`)) return Response.json({ error: 'unavailable', message: '本主题暂不可用' }, { status: 503 });
    if (path === '/v1/me') return Response.json({ id: 'user', name: '开发者', isAdmin: admin, memberships: [{ projectId: resourcesProjectId, role: 'developer' }] });
    if (path === `/v1/projects/${resourcesProjectId}`) return Response.json({ id: resourcesProjectId, serviceId: resourcesServiceId, name: '示例项目', slug: 'demo', namespace: 'cs-demo', kind: state.kind, state: 'active' });
    if (path.endsWith('/capabilities')) return Response.json(state.invalid ? {} : capability);
    if (path.endsWith('/repository')) return Response.json({ serviceId: resourcesServiceId, pathWithNamespace: 'crew/demo', defaultBranch: 'main', state: 'ready', httpUrl: 'https://repo.test/crew/demo' });
    if (path.endsWith('/subscriptions')) return Response.json({ items: [subscription] });
    if (path.endsWith('/dev-session')) return Response.json({ error: 'not_found', message: '请先创建开发会话' }, { status: 404 });
    return Response.json({ items: [] });
  }) as typeof fetch;
  return { state, calls };
}
