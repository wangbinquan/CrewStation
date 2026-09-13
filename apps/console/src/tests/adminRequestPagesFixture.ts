import type { ApiRequestPage, EgressRequestPage, ProjectId, ServiceId, UserId } from '@crewstation/contracts';

const userId = `usr_${'a'.repeat(32)}` as UserId, now = '2026-09-14T01:00:00.000Z';
export function adminRequestPagesFixture() {
  const calls: Array<{ url: URL; method: string; body?: Record<string, unknown> }> = [];
  const state = { admin: true, apiError: 0, egressError: 0, invalidApi: false, invalidEgress: false, decisionError: false, wrongDecision: false,
    holdDecision: undefined as Promise<void> | undefined, holdApi: undefined as Promise<void> | undefined };
  const project = (i: number) => ({ id: `prj_${(i % 3).toString(16).padStart(32, '0')}` as ProjectId, name: `申请项目 ${i % 3}`, slug: `tenant-${i % 3}`, kind: 'DigitalWorker' as const });
  const apiRequests: ApiRequestPage['items'] = Array.from({ length: 48 }, (_, i) => ({
    id: `req_${i.toString(16).padStart(32, '0')}`, projectId: project(i).id, project: project(i), serviceId: `svc_${(i % 3).toString(16).padStart(32, '0')}` as ServiceId,
    operationKey: `billing:GET:/invoices/${i}`, state: i < 45 ? 'pending' : 'approved', requestedBy: userId, createdAt: now, reason: `账单申请 ${i}`,
  }));
  const egressRequests: EgressRequestPage['items'] = Array.from({ length: 45 }, (_, i) => ({
    id: `egq_${i.toString(16).padStart(32, '0')}`, projectId: project(i).id, project: project(i), fqdn: `model-${i}.example.invalid`,
    state: i < 43 ? 'pending' : 'rejected', requestedBy: userId, createdAt: now, reason: `出站用途 ${i}`,
  }));
  globalThis.fetch = (async (raw, init) => {
    const url = new URL(String(raw), 'http://localhost'), method = init?.method ?? 'GET';
    const input = init?.body ? JSON.parse(String(init.body)) as Record<string, unknown> : undefined;
    calls.push({ url, method, body: input }); let body: unknown = { items: [] }, status = 200;
    if (url.pathname === '/v1/me') body = { id: userId, name: '审批管理员', isAdmin: state.admin, memberships: [] };
    else if (url.pathname === '/v1/api-requests/page' || url.pathname === '/v1/egress/requests/page') {
      const api = url.pathname === '/v1/api-requests/page', source = api ? apiRequests : egressRequests, name = api ? 'api' : 'egress';
      if (api) await state.holdApi;
      const failure = api ? state.apiError : state.egressError, cursor = url.searchParams.get('cursor');
      if (failure || !state.admin) { status = failure || 403; body = { error: 'unavailable', message: api ? 'API 分页读取失败' : '出站分页读取失败' }; }
      else if (cursor && !cursor.startsWith(`${name}:`)) { status = 400; body = { error: 'validation', message: '申请游标不匹配' }; }
      else {
        const offset = Number(cursor?.split(':')[1] ?? 0), limit = Number(url.searchParams.get('limit') ?? 20);
        const selected = source.filter((r) => (!url.searchParams.has('projectId') || r.projectId === url.searchParams.get('projectId')) && (url.searchParams.get('state') === 'all' || r.state === url.searchParams.get('state')));
        body = (api ? state.invalidApi : state.invalidEgress) ? { items: [selected[0], selected[0]] } : { items: selected.slice(offset, offset + limit), ...(offset + limit < selected.length ? { nextCursor: `${name}:${offset + limit}` } : {}) };
      }
    } else if (url.pathname.endsWith('/decision') && method === 'POST') {
      await state.holdDecision;
      const source = url.pathname.startsWith('/v1/api-requests/') ? apiRequests : egressRequests;
      const request = source.find((r) => url.pathname.includes(`/${r.id}/`));
      if (state.decisionError) { status = 503; body = { error: 'unavailable', message: '裁定提交失败' }; }
      else if (!request || request.state !== 'pending') { status = 409; body = { error: 'conflict', message: '申请状态已变化' }; }
      else { request.state = input!.approve ? 'approved' : 'rejected'; request.decision = input!.decision as string; request.decidedBy = userId; request.decidedAt = now;
        body = state.wrongDecision ? { ...request, id: 'wrong-request' } : request; }
    } else if (['/v1/projects', '/v1/api-requests', '/v1/egress/requests'].includes(url.pathname)) {
      status = 500; body = { error: 'unexpected', message: '不应读取全量目录或申请' };
    }
    return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
  }) as typeof fetch;
  return { state, calls, apiRequests, egressRequests, writes: () => calls.filter((c) => c.method !== 'GET') };
}
