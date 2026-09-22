import type { ApiRequestPage, ProjectId, ServiceId, UserId } from '@crewstation/contracts';

const userId = '01a0bf5d-8f4b-7f8b-8136-e631380738b0' as UserId, now = '2026-09-14T01:00:00.000Z';
export function adminRequestPagesFixture() {
  const calls: Array<{ url: URL; method: string; body?: Record<string, unknown> }> = [];
  const state = { admin: true, apiError: 0, invalidApi: false, decisionError: false, wrongDecision: false,
    holdDecision: undefined as Promise<void> | undefined, holdApi: undefined as Promise<void> | undefined };
  const project = (i: number) => ({ id: `01a0bf5d-8f4b-7a01-8000-${(i % 3).toString(16).padStart(12, '0')}` as ProjectId, name: `申请项目 ${i % 3}`, slug: `tenant-${i % 3}`, kind: 'DigitalWorker' as const });
  const apiRequests: ApiRequestPage['items'] = Array.from({ length: 48 }, (_, i) => ({
    id: `01a0bf5d-8f4b-7a04-8000-${i.toString(16).padStart(12, '0')}`, projectId: project(i).id, project: project(i), serviceId: `01a0bf5d-8f4b-7a02-8000-${(i % 3).toString(16).padStart(12, '0')}` as ServiceId,
    operationId: `01a0bf5d-8f4b-7a06-8000-${i.toString(16).padStart(12, '0')}`, state: i < 45 ? 'pending' : 'approved', requestedBy: userId, createdAt: now, reason: `账单申请 ${i}`,
  }));
  globalThis.fetch = (async (raw, init) => {
    const url = new URL(String(raw), 'http://localhost'), method = init?.method ?? 'GET';
    const input = init?.body ? JSON.parse(String(init.body)) as Record<string, unknown> : undefined;
    calls.push({ url, method, body: input }); let body: unknown = { items: [] }, status = 200;
    // RFC-018：出站接口已删除。打到它就是 500，界面上任何残留调用都会立刻红。
    if (url.pathname.startsWith('/v1/egress') || url.pathname.includes('/egress/')) { status = 500; body = { error: 'unexpected', message: '出站接口已下线，不应被调用' }; }
    else if (url.pathname === '/v1/me') body = { id: userId, name: '审批管理员', platformRole: (state.admin) ? 'admin' : 'developer', isAdmin: state.admin, memberships: [] };
    else if (url.pathname === '/v1/api-requests/page') {
      await state.holdApi;
      const cursor = url.searchParams.get('cursor');
      if (state.apiError || !state.admin) { status = state.apiError || 403; body = { error: 'unavailable', message: 'API 分页读取失败' }; }
      else if (cursor && !cursor.startsWith('api:')) { status = 400; body = { error: 'validation', message: '申请游标不匹配' }; }
      else {
        const offset = Number(cursor?.split(':')[1] ?? 0), limit = Number(url.searchParams.get('limit') ?? 20);
        const selected = apiRequests.filter((r) => (!url.searchParams.has('projectId') || r.projectId === url.searchParams.get('projectId')) && (url.searchParams.get('state') === 'all' || r.state === url.searchParams.get('state')));
        body = state.invalidApi ? { items: [selected[0], selected[0]] } : { items: selected.slice(offset, offset + limit), ...(offset + limit < selected.length ? { nextCursor: `api:${offset + limit}` } : {}) };
      }
    } else if (url.pathname.endsWith('/decision') && method === 'POST') {
      await state.holdDecision;
      const request = apiRequests.find((r) => url.pathname.includes(`/${r.id}/`));
      if (state.decisionError) { status = 503; body = { error: 'unavailable', message: '裁定提交失败' }; }
      else if (!request || request.state !== 'pending') { status = 409; body = { error: 'conflict', message: '申请状态已变化' }; }
      else { request.state = input!.approve ? 'approved' : 'rejected'; request.decision = input!.decision as string; request.decidedBy = userId; request.decidedAt = now;
        body = state.wrongDecision ? { ...request, id: 'wrong-request' } : request; }
    } else if (['/v1/projects', '/v1/api-requests'].includes(url.pathname)) {
      status = 500; body = { error: 'unexpected', message: '不应读取全量目录或申请' };
    }
    return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
  }) as typeof fetch;
  return { state, calls, apiRequests, writes: () => calls.filter((c) => c.method !== 'GET') };
}
