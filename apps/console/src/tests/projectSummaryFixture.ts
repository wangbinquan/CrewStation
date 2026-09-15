import type { ProjectSummaryDetail, UserId } from '@crewstation/contracts';

export const summaryUserId = `usr_${'a'.repeat(32)}` as UserId;
export function summaryFixtureItem(n = 1): ProjectSummaryDetail {
  const time = new Date().toISOString(), part = { status: 'ready' as const, checkedAt: time };
  return { project: { id: `prj_${n.toString(16).padStart(32, '0')}` as ProjectSummaryDetail['project']['id'],
    serviceId: `svc_${n.toString(16).padStart(32, '0')}` as ProjectSummaryDetail['project']['serviceId'], slug: `demo-${n}`, name: `数字助手 ${n}`, kind: 'DigitalWorker',
    namespace: `cs-demo-${n}`, ownerUserId: summaryUserId as ProjectSummaryDetail['project']['ownerUserId'], state: 'active', createdAt: time },
    role: 'owner', ownerName: '王负责人', development: { ...part, value: null }, slots: { ...part, value: [] },
    health: { status: 'unknown', reason: 'not-provided', checkedAt: time }, releases: { ...part, value: [] }, switches: { ...part, value: [] }, checkedAt: time };
}

export function testerSummaryFixture(projectId: string, serviceId: string): ProjectSummaryDetail {
  const item = summaryFixtureItem(), restricted = { status: 'restricted' as const, checkedAt: item.checkedAt };
  return { ...item, project: { ...item.project, id: projectId as ProjectSummaryDetail['project']['id'], serviceId: serviceId as ProjectSummaryDetail['project']['serviceId'] },
    role: 'tester', development: restricted, slots: restricted, health: restricted, releases: restricted, switches: restricted,
    preview: { status: 'ready', value: null, checkedAt: item.checkedAt } };
}

export function summaryFixture() {
  const state = { item: summaryFixtureItem(), admin: true, meError: false, projectDenied: false, error: false, invalid: false, empty: false, hang: false, calls: [] as string[], writes: [] as string[] };
  globalThis.fetch = (async (raw, init) => {
    const url = new URL(String(raw), 'http://test'); state.calls.push(url.pathname + url.search);
    if (init?.method && init.method !== 'GET') state.writes.push(url.pathname);
    let body: unknown = { items: [] }, status = 200;
    if (url.pathname === '/v1/me') {
      if (state.meError) { status = 503; body = { error: 'unavailable', message: '身份读取失败' }; }
      else body = { id: summaryUserId, name: '王负责人', email: 'owner@test.invalid', isAdmin: state.admin, memberships: [{ projectId: state.item.project.id, role: state.item.role }] };
    }
    else if (url.pathname.startsWith('/v1/workbench/project-summaries')) {
      if (state.hang) return new Promise<Response>(() => {});
      if (state.error) { status = 503; body = { error: 'unavailable', message: '摘要读取失败' }; }
      else if (state.invalid) body = { items: [{ project: {} }] };
      else if (url.pathname.endsWith(state.item.project.id)) body = state.item;
      else body = { items: state.empty ? [] : url.searchParams.has('cursor') ? [summaryFixtureItem(2)] : [state.item], ...(url.searchParams.has('cursor') || state.empty ? {} : { nextCursor: 'next-page' }) };
    } else if (url.pathname.endsWith('/dev-session')) { status = 404; body = { error: 'not_found', message: '没有开发会话' }; }
    else if (url.pathname === `/v1/projects/${state.item.project.id}`) {
      if (state.projectDenied) { status = 403; body = { error: 'forbidden', message: '角色 tester 不能执行 view' }; }
      else body = state.item.project;
    }
    else if (url.pathname === `/v1/services/${state.item.project.serviceId}`) body = { id: state.item.project.serviceId, projectId: state.item.project.id };
    return Response.json(body, { status });
  }) as typeof fetch;
  return state;
}
