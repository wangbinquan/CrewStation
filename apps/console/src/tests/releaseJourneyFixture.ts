import type { ReleaseJourneyDetail, ReleaseJourneyListItem } from '@crewstation/contracts';
import { releaseDeliveryFixture, projectId, serviceId, targetId, userId } from './releaseDeliveryFixture';

export const journeyId = '01a11e42-fe19-7c81-9ce5-44a6072613f4', taskId = '01a11e42-fe19-7c81-9ce5-44a6072613f5';
export const targetRevision = 'c'.repeat(64), startedAt = '2026-10-09T01:00:00.000Z';
export function releaseJourneyFixture() {
  sessionStorage.clear();
  const f = releaseDeliveryFixture(), base = globalThis.fetch, release = f.releases[1]!;
  release.journeyId = journeyId;
  f.state.slots[1]!.targetRevision = targetRevision;
  const detail: ReleaseJourneyDetail = {
    recordKind: 'journey', id: journeyId as never, snapshot: { projectId: projectId as never, serviceId: serviceId as never, releaseId: release.id, kind: 'publish', source: { kind: 'repository' },
      tag: release.tag, branch: 'main', commitSha: release.commitSha, actorUserId: userId as never, startedAt },
    status: 'awaiting-verification', revision: 7, updatedAt: startedAt, events: [], release, slots: f.state.slots,
    stages: [{ stage: 'prepare', state: 'succeeded', finishedAt: startedAt }, { stage: 'build', state: 'succeeded', startedAt, finishedAt: startedAt, durationMs: 0 }, { stage: 'deploy', state: 'succeeded' }, { stage: 'ready', state: 'succeeded' }, { stage: 'verification', state: 'pending' }, { stage: 'launch', state: 'pending' }, { stage: 'complete', state: 'pending' }],
    continuation: { canVerify: true, canLaunch: false, targetRevision, expectedActiveReleaseId: f.releases[0]!.id },
  };
  const state = { dirty: false, noSession: false, readError: false, publishError: 0, responseMismatch: false, loseResponse: false, note: '', rows: undefined as ReleaseJourneyListItem[] | undefined };
  const summary = () => ({ recordKind: detail.recordKind, id: detail.id, snapshot: detail.snapshot, status: detail.status, revision: detail.revision, updatedAt: detail.updatedAt });
  globalThis.fetch = (async (raw, init) => {
    const url = new URL(String(raw), 'http://localhost'), path = url.pathname, method = init?.method ?? 'GET';
    if (method === 'GET') {
      if (path.includes('/release-journeys') || path.endsWith('/journey-history') || path.endsWith('/workspace-status')) f.reads.push(path + url.search);
      if (path === `/v1/release-journeys/${journeyId}`) return state.readError ? Response.json({ error: 'unavailable', message: '流程读取失败' }, { status: 503 }) : Response.json({ ...detail, slots: f.state.slots });
      if (path.endsWith('/release-journeys')) {
        const rows = state.rows ?? [summary()], offset = Number(url.searchParams.get('cursor') ?? 0), limit = Number(url.searchParams.get('limit') ?? 20), items = rows.slice(offset, offset + limit);
        return Response.json({ items, hasMore: offset + limit < rows.length, ...(offset + limit < rows.length ? { nextCursor: String(offset + limit) } : {}) });
      }
      if (path.endsWith(`/releases/${targetId}/journey-history`)) return Response.json({ journeys: [summary()], trafficSwitches: [], slotEvents: [] });
      if (path.endsWith('/workspace-status')) return state.noSession ? Response.json({ error: 'not_found', message: '没有开发会话' }, { status: 404 }) : Response.json({ taskId, status: 'ready', branch: 'main', headSha: 'a'.repeat(40), shallow: false, fingerprint: 'fp', checkedAt: startedAt,
        uncommittedCount: state.dirty ? 1 : 0, uncommittedTruncated: false, uncommitted: state.dirty ? [{ path: '未提交.ts', status: '.M', index: '.', worktree: 'M' }] : [], unpushed: { status: 'ready', commits: [], count: 0, truncated: false }, upstream: { status: 'missing' } });
      return base(raw, init);
    }
    const input = JSON.parse(String(init?.body ?? '{}')); f.writes.push({ path, body: input }); await f.state.hold;
    if (path.endsWith('/verification')) {
      detail.status = 'awaiting-confirmation'; detail.revision++;
      detail.verification = { actorUserId: userId as never, at: startedAt, targetRevision, ...(input.note ? { note: input.note } : {}) };
      detail.continuation.canVerify = false; detail.continuation.canLaunch = true;
      detail.stages.find(stage => stage.stage === 'verification')!.state = 'succeeded';
      return Response.json(detail);
    }
    if (path.endsWith('/traffic-switch')) {
      if (f.state.failSwitch) return Response.json({ error: 'precondition', message: '维护窗口已关闭' }, { status: 412 });
      detail.status = 'running'; detail.continuation.canLaunch = false;
      detail.trafficSwitch = { id: 'tsw-journey', journeyId: detail.id, serviceId: serviceId as never, releaseId: release.id, previousReleaseId: f.releases[0]!.id, fromSlot: 'preview', toSlot: 'prod', actorUserId: userId as never, createdAt: startedAt, ...(f.state.controlled ? { handoff: { stage: 'freezing' as const } } : {}) };
      if (state.loseResponse) return Response.json({ error: 'unavailable', message: '响应连接中断' }, { status: 503 });
      return Response.json(detail.trafficSwitch);
    }
    if (state.publishError) return Response.json({ error: 'precondition', message: '工作树 HEAD 已变化' }, { status: state.publishError });
    Object.assign(release, { tag: input.version, commitSha: input.expectedCommitSha, branch: input.branch, status: 'pending' });
    Object.assign(detail.snapshot, { tag: release.tag, commitSha: release.commitSha, message: input.message, source: input.expectedTaskId ? { kind: 'session', taskId: input.expectedTaskId } : { kind: 'repository' } });
    detail.status = 'running'; detail.stages = [{ stage: 'prepare', state: 'succeeded' }, { stage: 'queued', state: 'running', startedAt }]; detail.continuation.canVerify = false;
    if (state.loseResponse) return Response.json({ error: 'unavailable', message: '响应连接中断' }, { status: 503 });
    return Response.json({ ...release, ...(state.responseMismatch ? { serviceId: projectId } : {}) }, { status: 202 });
  }) as typeof fetch;
  return { ...f, delivery: f.state, detail, state, summary };
}
