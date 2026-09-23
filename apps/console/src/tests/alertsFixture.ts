import type { AlertDto } from '@crewstation/contracts';

export const projectId = '01a0bf5d-8f4b-7e1e-8dde-c9c2ae13ed34', serviceId = '01a0bf5d-8f4b-760b-86b6-0bb9f08a9eaa', ownerId = '01a0bf5d-8f4b-7ed2-8386-a4b2e1a36efb';
export const alertId = `alr_${'e'.repeat(32)}`;
export function alertsFixture() {
  const time = '2026-09-13T01:00:00.000Z';
  const alerts = [
    { id: alertId, projectId, type: 'health-failing', state: 'firing', detail: 'preview 健康未通过', firedAt: time, slot: 'preview' },
    { id: 'old-alert', projectId, type: 'crash-loop', state: 'resolved', detail: '文字含 prod，但未提供关联对象', firedAt: time, resolvedAt: '2026-09-13T01:05:00.000Z' },
  ] as AlertDto[];
  const state = { role: 'owner', admin: false, failAlerts: false, wrongProject: false };
  const writes: Array<{ path: string; method: string }> = [], reads: string[] = [];
  globalThis.fetch = (async (raw, init) => {
    const path = new URL(String(raw), 'http://localhost').pathname, method = init?.method ?? 'GET'; let body: unknown = { items: [] }, status = 200;
    if (method !== 'GET') writes.push({ path, method });
    else {
      reads.push(path);
      if (path === '/v1/me') body = { id: ownerId, name: '王负责人', email: 'owner@test.invalid', platformRole: (state.admin) ? 'admin' : 'developer', isAdmin: state.admin, authMethod: 'password' as const, memberships: [{ projectId, role: state.role }] };
      else if (path === `/v1/projects/${projectId}`) body = { id: projectId, serviceId, name: '演示应用', slug: 'demo', kind: state.admin ? 'APIProxy' : 'DigitalWorker', state: 'active', ownerUserId: ownerId };
      else if (path.endsWith('/alerts')) { if (state.failAlerts) { status = 503; body = { error: 'unavailable', message: '读取告警失败' }; } else body = { items: alerts.map((row) => ({ ...row, projectId: state.wrongProject ? '01a0bf5d-8f4b-70bd-8586-401e32bbc3b4' : projectId })) }; }
      else if (path.endsWith('/dev-session')) { status = 404; body = { error: 'not_found', message: '没有开发会话' }; }
    }
    return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
  }) as typeof fetch;
  return { alerts, state, writes, reads };
}
