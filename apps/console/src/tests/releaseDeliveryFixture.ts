import type { ReleaseDto, SlotDto } from '@crewstation/contracts';
import { testerSummaryFixture, trialMarketFixture } from './projectSummaryFixture';

export const projectId = '01a0bf5d-8f4b-7e1e-8dde-c9c2ae13ed34', serviceId = '01a0bf5d-8f4b-760b-86b6-0bb9f08a9eaa', userId = '01a0bf5d-8f4b-7ed2-8386-a4b2e1a36efb';
export const prodId = '01a0bf5d-8f4b-762d-81e1-f95f4dd57c2d', targetId = '01a0bf5d-8f4b-7dda-8ca7-d5d5f8a92b44', historyId = '01a0bf5d-8f4b-7fd8-80e1-98a6fb83510b';
const sha = 'a'.repeat(40), time = '2026-09-13T01:00:00.000Z';

export function releaseDeliveryFixture() {
  const makeRelease = (id: string, tag: string, commitSha: string, createdAt: string) => ({ id, serviceId, tag, commitSha, branch: 'main', status: 'ready', createdBy: userId, createdAt, updatedAt: createdAt }) as ReleaseDto;
  const prod = makeRelease(prodId, 'v1.0.0', sha, time), candidate = makeRelease(targetId, 'v1.1.0', 'b'.repeat(40), '2026-09-13T02:00:00.000Z');
  const releases = [prod, candidate, makeRelease(historyId, 'v0.9.0', 'c'.repeat(40), '2026-09-12T01:00:00.000Z')];
  const slot = (name: 'prod' | 'preview', release: ReleaseDto): SlotDto => ({ name, active: name === 'prod', releaseId: release.id, tag: release.tag, commitSha: release.commitSha, replicas: 1, readyReplicas: 1, state: 'ready', host: name === 'prod' ? 'demo.cs.localhost' : 'preview.demo.cs.localhost' });
  const state = { role: 'owner', admin: false, failSlots: false, failSwitch: false, mismatch: false, badRelease: false, hold: undefined as Promise<void> | undefined, slots: [slot('prod', prod), slot('preview', candidate)] };
  const writes: Array<{ path: string; body: Record<string, unknown> }> = [], reads: string[] = [];
  globalThis.fetch = (async (raw, init) => {
    const path = new URL(String(raw), 'http://localhost').pathname, method = init?.method ?? 'GET'; let body: unknown = { items: [] }, status = 200;
    if (method !== 'GET') {
      const input = JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown>; writes.push({ path, body: input }); await state.hold;
      if (path.endsWith('/traffic-switch')) {
        if (state.failSwitch) { status = 412; body = { error: 'precondition', message: '当前版本含破坏性迁移，不能切回旧版本' }; }
        else {
          body = { id: 'tsw_example', serviceId, fromSlot: 'preview', toSlot: 'prod', releaseId: state.mismatch ? historyId : input.expectedTargetRelease, ...(input.expectedActiveRelease ? { previousReleaseId: input.expectedActiveRelease } : {}), actorUserId: userId, createdAt: time };
          if (!state.mismatch) { const current = state.slots[0]!, target = state.slots[1]!; state.slots = [{ ...target, name: 'prod', active: true, host: current.host }, { ...current, name: 'preview', active: false, host: target.host }]; }
        }
      } else { status = 202; body = { ...candidate, commitSha: input.expectedCommitSha, status: 'pending' }; }
    } else {
      reads.push(path);
      if (path === '/v1/me') body = { id: userId, name: '负责人', email: 'owner@test.invalid', platformRole: (state.admin) ? 'admin' : 'developer', isAdmin: state.admin, memberships: [{ projectId, role: state.role }] };
      else if (path === '/v1/market/apps') body = { items: [trialMarketFixture(projectId)] };
      else if (path === `/v1/market/apps/${projectId}`) body = trialMarketFixture(projectId);
      else if (path === `/v1/workbench/project-summaries/${projectId}`) body = testerSummaryFixture(projectId, serviceId);
      else if (path === `/v1/projects/${projectId}`) body = { id: projectId, serviceId, name: '演示应用', slug: 'demo', kind: state.admin ? 'APIProxy' : 'DigitalWorker', state: 'active', ownerUserId: userId };
      else if (path.endsWith('/slots')) { if (state.failSlots) { status = 503; body = { error: 'unavailable', message: '部署读取失败' }; } else body = { items: state.slots }; }
      else if (path.startsWith('/v1/releases/')) { const item = releases.find((release) => path.endsWith(release.id)); body = state.badRelease ? { ...item, serviceId: '01a0bf5d-8f4b-7f17-8623-f7330845107a' } : item; }
      else if (path.endsWith('/releases')) body = { items: releases };
      else if (path.endsWith('/branches')) body = { items: [{ name: 'main', headSha: sha, isDefault: true, behindPreview: null, behindProd: null }] };
      else if (path.endsWith('/tags')) body = { items: releases.map((release) => ({ name: release.tag, commitSha: release.commitSha, protected: true, createdAt: release.createdAt })) };
      else if (path.endsWith('/dev-session')) { status = 404; body = { error: 'not_found', message: '没有开发会话' }; }
    }
    return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
  }) as typeof fetch;
  return { state, writes, reads, releases };
}
