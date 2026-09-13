import type { ApiRequestPage, EgressRequestPage, ProjectId, ProjectPageEntry, ServiceId, UserId } from '@crewstation/contracts';

const userId = `usr_${'a'.repeat(32)}` as UserId, now = '2026-09-14T00:00:00.000Z';
export function adminDirectoryFixture() {
  const calls: Array<{ url: URL; method: string }> = [];
  const state = { admin: true, identityError: false, projectError: false, apiError: false, egressError: false, invalidProject: false,
    holdApi: undefined as Promise<void> | undefined };
  const projects: ProjectPageEntry[] = Array.from({ length: 48 }, (_, i) => ({ role: 'admin', ownerName: '负责人甲', project: {
    id: `prj_${i.toString(16).padStart(32, '0')}` as ProjectId, serviceId: `svc_${i.toString(16).padStart(32, '0')}` as ServiceId, ownerUserId: userId,
    name: `管理项目 ${i}`, slug: `managed-${i}`, kind: i % 3 === 0 ? 'DigitalWorker' : i % 3 === 1 ? 'APIProxy' : 'EventProducer',
    namespace: `cs-managed-${i}`, state: i < 12 ? 'failed' : 'active', message: i < 12 ? '生产配置尚未补齐' : undefined, createdAt: now,
  } }));
  const apiRequests: ApiRequestPage['items'] = projects.slice(0, 8).map(({ project }, i) => ({ id: `req-${i}`, projectId: project.id, project,
    serviceId: project.serviceId!, operationKey: `billing:GET:/reports/${i}`, state: 'pending', requestedBy: userId, createdAt: now, reason: `查询账单 ${i}` }));
  const egressRequests: EgressRequestPage['items'] = projects.slice(0, 7).map(({ project }, i) => ({ id: `egq-${i}`, projectId: project.id, project,
    fqdn: `api-${i}.example.test`, state: 'pending', requestedBy: userId, createdAt: now, reason: `开发依赖 ${i}` }));
  globalThis.fetch = (async (input, init) => {
    const url = new URL(String(input), 'http://localhost'), method = init?.method ?? 'GET'; calls.push({ url, method });
    let body: unknown = { items: [] }, status = 200;
    if (url.pathname === '/v1/me') { if (state.identityError) { status = 503; body = { error: 'unavailable', message: '管理身份离线' }; }
      else body = { id: userId, name: '管理员', email: 'admin@test.invalid', isAdmin: state.admin, memberships: [] }; }
    else if (url.pathname === '/v1/projects/page') {
      if (state.projectError) { status = 503; body = { error: 'unavailable', message: '管理项目目录离线' }; }
      else if (state.invalidProject) body = { items: [{}] };
      else { const kinds = url.searchParams.get('kind')?.split(',') ?? ['DigitalWorker'];
        const rows = projects.filter(({ project: p }) => kinds.includes(p.kind) && (!url.searchParams.get('state') || p.state === url.searchParams.get('state')) &&
          (!url.searchParams.get('q') || `${p.name} ${p.slug}`.includes(url.searchParams.get('q')!)) && (!url.searchParams.get('ownerUserId') || p.ownerUserId === url.searchParams.get('ownerUserId')));
        const from = Number(url.searchParams.get('cursor') ?? 0), limit = Number(url.searchParams.get('limit') ?? 20);
        body = { items: rows.slice(from, from + limit), ...(from + limit < rows.length ? { nextCursor: String(from + limit) } : {}) }; }
    } else if (url.pathname === '/v1/projects') body = { items: projects.map((p) => p.project) };
    else if (url.pathname === '/v1/api-requests/page') {
      if (state.holdApi) await state.holdApi;
      if (state.apiError) { status = 503; body = { error: 'unavailable', message: 'API 待办离线' }; }
      else { const limit = Number(url.searchParams.get('limit') ?? 20); body = { items: apiRequests.slice(0, limit), ...(limit < apiRequests.length ? { nextCursor: 'next-api' } : {}) }; }
    } else if (url.pathname === '/v1/egress/requests/page') {
      if (state.egressError) { status = 503; body = { error: 'unavailable', message: '出站待办离线' }; }
      else { const limit = Number(url.searchParams.get('limit') ?? 20); body = { items: egressRequests.slice(0, limit), ...(limit < egressRequests.length ? { nextCursor: 'next-egress' } : {}) }; }
    } else if (url.pathname.startsWith('/v1/projects/')) body = projects.find((p) => url.pathname === `/v1/projects/${p.project.id}`)?.project ?? { items: [] };
    return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
  }) as typeof fetch;
  return { calls, state, projects, apiRequests, egressRequests, writes: () => calls.filter((r) => r.method !== 'GET') };
}
