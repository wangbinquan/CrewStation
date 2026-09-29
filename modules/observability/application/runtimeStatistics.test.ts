// RFC-034: both scopes and every drill-down use the same direct task/attempt facts.
import { expect, test } from 'bun:test';
import type { Actor, ProjectId, TaskId, UserId, RuntimeTaskFact, RuntimeAttemptFact } from '@crewstation/contracts';
import { ExecutionUsageObservationSchema, RuntimeTaskFactSchema, RuntimeNativeCaptureSchema } from '@crewstation/contracts';
import { newResourceId } from '@crewstation/kernel';
import { runtimeStatisticsUseCases } from './executionObservations';
import type { RuntimeStatisticsSnapshot } from '../ports/usageLedger';
const projectId = newResourceId() as ProjectId, taskId = newResourceId() as TaskId, actor = { userId: newResourceId() as UserId, isAdmin: true } satisfies Actor;
const at = '2026-09-28T12:00:00.000Z', query = { from: '2026-09-28T00:00:00.000Z', to: '2026-09-29T00:00:00.000Z', timezone: 'Asia/Shanghai' };
function attempt(patch: Partial<RuntimeAttemptFact> = {}): RuntimeAttemptFact { return { id: newResourceId(), taskId, executionId: newResourceId(), agentId: newResourceId(), profileId: newResourceId(), profileRevision: 1, name: 'Builder', kind: 'agent', state: 'succeeded', attempt: 1, createdAt: query.from, startedAt: query.from, endedAt: '2026-09-28T00:00:10.000Z', ...patch }; }
function task(attempts: RuntimeAttemptFact[], patch: Partial<RuntimeTaskFact> = {}) { return RuntimeTaskFactSchema.parse({ id: taskId, projectId, serviceId: newResourceId(), name: 'Task', protocol: 'v3', state: 'closed', createdAt: query.from, closedAt: '2026-09-28T00:00:20.000Z', traceId: null, attempts, attemptsPartial: false, ...patch }); }
function setup(tasks: RuntimeTaskFact[], patch: Partial<RuntimeStatisticsSnapshot> = {}) {
  let reads = 0, auth = 0; const snapshot = { tasks, observations: [], partial: false, costVisible: {}, ...patch } satisfies RuntimeStatisticsSnapshot;
  const api = runtimeStatisticsUseCases({ source: { read: async () => { reads++; return snapshot; } }, authorizer: { authorize: async () => { auth++; } }, clock: { now: () => new Date(at) } });
  return { api, counts: () => ({ reads, auth }) };
}
test('task wall time, cumulative attempts, union and nearest-rank percentiles remain separate', async () => {
  const a = attempt(), b = attempt({ agentId: a.agentId, profileId: a.profileId, startedAt: '2026-09-28T00:00:05.000Z', endedAt: '2026-09-28T00:00:15.000Z', attempt: 2 });
  const f = setup([task([a, b])]); const page = await f.api.systemRuntimeStatistics(actor, query);
  expect(page.tasks[0]).toMatchObject({ wallMs: 20000, cumulativeMs: 20000, activeUnionMs: 15000, unknownIntervals: 0, attemptCount: 2 });
  expect(page.durations).toEqual({ samples: 1, p50Ms: 20000, p95Ms: 20000, maxMs: 20000 });
  expect(page.agents).toHaveLength(1); expect(page.agents[0]?.tasks[0]?.attempts).toBe(2); expect(page.metrics.executions).toBe(2);
  expect(page.metrics.tokens.hasKnown).toBe(false); expect(page.metrics.tokens.unknownBuckets.input).toBe(2);
  expect(f.counts().reads).toBe(1);
});
test('project views preserve their fields and hidden cost policy even for system administrators', async () => {
  const f = setup([task([attempt()])]); const page = await f.api.projectRuntimeStatistics(actor, projectId, query);
  expect(page.scope).toBe('project'); expect('models' in page).toBe(false); expect(page.metrics.cost).toEqual({ currency: 'CNY', amount: null, complete: false, visible: false });
  expect(f.counts()).toEqual({ reads: 1, auth: 2 });
  await expect(f.api.systemRuntimeStatistics({ ...actor, isAdmin: false }, query)).rejects.toMatchObject({ kind: 'forbidden' });
  expect(f.counts().reads).toBe(1);
});
test('unknown terminal timing is never extended to now or counted as a percentile sample', async () => {
  const f = setup([task([attempt({ endedAt: null })], { closedAt: null })]); const page = await f.api.systemRuntimeStatistics(actor, query);
  expect(page.tasks[0]?.wallMs).toBeNull(); expect(page.tasks[0]?.unknownIntervals).toBe(1); expect(page.durations.samples).toBe(0);
  expect(page.quality.find((q) => q.reason === 'timing-missing')?.taskIds).toEqual([taskId]);
  const detail = await f.api.systemRuntimeTask(actor, taskId); expect(detail.attempts[0]?.durationMs).toBeNull(); expect(detail.attempts[0]?.open).toBe(false);
});
test('open intervals freeze at asOf, commands are not agents and truncation remains explicit', async () => {
  const f = setup([task([attempt({ kind: 'command', endedAt: null, state: 'running' })], { state: 'running', closedAt: null, attemptsPartial: true })], { partial: true });
  const page = await f.api.systemRuntimeStatistics(actor, query), detail = await f.api.systemRuntimeTask(actor, taskId);
  expect(page.agents).toEqual([]); expect(page.metrics.executions).toBe(0); expect(page.partial).toBe(true); expect(page.metrics.reasons).toContain('truncated');
  expect(detail.attempts[0]).toMatchObject({ durationMs: 43200000, open: true });
});
test('detail refuses missing or wrong-project facts and source errors propagate', async () => {
  const f = setup([task([])]); await expect(f.api.projectRuntimeTask(actor, newResourceId() as ProjectId, taskId)).rejects.toMatchObject({ kind: 'not_found' });
  const api = runtimeStatisticsUseCases({ source: { read: async () => { throw new Error('ledger unavailable'); } }, authorizer: { authorize: async () => {} }, clock: { now: () => new Date(at) } });
  await expect(api.systemRuntimeStatistics(actor, query)).rejects.toThrow('ledger unavailable');
});

test('a stale running child cannot keep extending after the parent task closed', async () => {
  const f = setup([task([attempt({ state: 'running', endedAt: null })])]);
  const detail = await f.api.systemRuntimeTask(actor, taskId);
  expect(detail.attempts[0]?.open).toBe(false); expect(detail.attempts[0]?.durationMs).toBeNull();
  expect(detail.wallMs).toBe(20000); expect(detail.unknownIntervals).toBe(1); expect(detail.activeUnionMs).toBe(0);
});

test('stable Agent identity survives task names while unknown same-name instances stay separate', async () => {
  const a = attempt(), b = attempt({ agentId: a.agentId, profileId: a.profileId, name: 'Another business step' });
  const c = attempt({ agentId: null, profileId: null, name: 'reviewer' }), d = attempt({ agentId: null, profileId: null, name: 'reviewer' });
  const f = setup([task([a, b, c, d])]), page = await f.api.systemRuntimeStatistics(actor, query);
  expect(page.agents).toHaveLength(3); expect(page.agents.find((x) => x.agentId === a.agentId)?.metrics.executions).toBe(2);
  const unknown = page.agents.filter((x) => x.agentId === null); expect(unknown).toHaveLength(2); expect(unknown[0]?.key).not.toBe(unknown[1]?.key);
});


test('all views share filtered contributions; Agent price-profile revisions remain identifiable', async () => {
  const a = attempt({ profileRevision: 7 }), otherId = newResourceId() as TaskId;
  const b = attempt({ taskId: otherId, agentId: a.agentId, profileId: a.profileId, profileRevision: 8 });
  const tasks = [task([a], { name: 'First' }), task([b], { id: otherId, name: 'Second' })];
  const observations = [a, b].map((attempt, i) => { const count = String((i + 1) * 100), usage = { input: count, cacheRead: '0', cacheWrite: '0', output: '0' }; return ExecutionUsageObservationSchema.parse({ kind: 'usage', identity: { projectId, taskId: attempt.taskId, subtaskId: attempt.id, executionId: attempt.executionId, executionGeneration: 1 }, sourceId: 'runner', recordId: attempt.id, revision: 1, occurredAt: at, observedAt: at, adapterVersion: 'test', modelRef: null, reporting: 'delta', inclusion: 'self', coverage: 'complete', validity: 'valid', scope: null, coveredThroughTurn: null, usage, basis: { kind: 'invocation' }, projection: { projectionRevision: 1, observedRevision: 1, contribution: usage, coveredThrough: null, complete: true, issues: [] } }); });
  const f = setup(tasks, { observations });
  const page = await f.api.systemRuntimeStatistics(actor, { ...query, q: 'First' });
  expect(page.tasks).toHaveLength(1); expect(page.agents).toHaveLength(1); expect(page.metrics.tokens.total).toBe('100'); expect(page.agents[0]?.metrics.tokens.total).toBe('100'); expect(page.models[0]?.metrics.tokens.total).toBe('100');
  expect(page.profiles[0]?.metrics.tokens.total).toBe('100');
  const all = await f.api.systemRuntimeStatistics(actor, query);
  expect(all.profiles).toHaveLength(2); expect(all.profiles.map((p) => p.profileRevision)).toEqual([7, 8]);
  expect(all.profiles.map((p) => p.tasks[0]!.metrics.tokens.total)).toEqual(['100', '200']);
  const project = await f.api.projectRuntimeStatistics(actor, projectId, query);
  expect(project.profiles).toHaveLength(2); expect(project.profiles.every((p) => !p.metrics.cost.visible)).toBe(true);

});

function nativeSummary(a: RuntimeAttemptFact, state: 'pending' | 'complete' | 'partial' | 'unsupported' = 'complete') {
  return RuntimeNativeCaptureSchema.parse({
    id: 'capture-' + a.id, identity: { projectId, taskId: a.taskId, subtaskId: a.id, executionId: a.executionId!, executionGeneration: a.attempt }, sourceId: 'runner',
    proof: { contract: 'opencode-child-steps-v1' as const, lineageKey: 'session', turn: 'turn', turnIndex: 0, state, root: 'root', observedAt: at,
      baseline: { kind: 'fresh' as const, fingerprint: null }, fingerprint: state === 'complete' ? 'final' : null, sessions: 1, steps: 0, emitted: 0, baselineSteps: 0, priorRevisionGap: false, issues: [] },
    state, issues: [], receivedSteps: 0, receivedBaselineSteps: 0, unresolvedBaselineSteps: 0, revisedBaselineSteps: 0, historicalRevisionGap: false,
  });
}
test('only complete native empty turns prove zero; pending, unsupported and other execution identities stay unknown', async () => {
  const a = attempt(), complete = nativeSummary(a);
  const f = setup([task([a])], { nativeCaptures: [complete] });
  const all = await f.api.systemRuntimeStatistics(actor, query);
  expect(all.metrics.tokens).toMatchObject({ total: '0', hasKnown: true, complete: true });
  expect(all.metrics.cost).toMatchObject({ amount: '0', complete: true }); expect(all.metrics.observedExecutions).toBe(1);
  const hidden = await f.api.projectRuntimeTask(actor, projectId, taskId);
  expect(hidden.metrics.cost).toMatchObject({ amount: null, complete: false, visible: false }); expect(hidden.attempts[0]?.nativeCaptures).toEqual([complete]);
  for (const state of ['pending', 'partial', 'unsupported'] as const) {
    const row = await setup([task([a])], { nativeCaptures: [nativeSummary(a, state)] }).api.systemRuntimeTask(actor, taskId);
    expect(row.metrics.tokens.hasKnown).toBe(false); expect(row.metrics.reasons).toContain('native-capture-' + state);
  }
  const mismatch = await setup([task([a])], { nativeCaptures: [{ ...complete, identity: { ...complete.identity, executionGeneration: 2 } }] }).api.systemRuntimeTask(actor, taskId);
  expect(mismatch.metrics.tokens.hasKnown).toBe(false); expect(mismatch.attempts[0]!.nativeCaptures).toEqual([]); expect(mismatch.metrics.reasons).toContain('identity-unmatched');
  const extra = await setup([task([a])], { nativeCaptures: [complete, { ...complete, id: 'orphan-proof', identity: { ...complete.identity, executionGeneration: 2 } }] }).api.systemRuntimeTask(actor, taskId);
  expect(extra.metrics.tokens.complete).toBe(false); expect(extra.partial).toBe(true); expect(extra.metrics.reasons).toContain('identity-unmatched');
});
test('proofs never hide unobserved turns and historical gaps keep known tokens as a lower bound', async () => {
  const a = attempt(), usage = { input: '10', output: '0', cacheRead: '0', cacheWrite: '0' };
  const observation = ExecutionUsageObservationSchema.parse({ kind: 'usage', identity: nativeSummary(a).identity, sourceId: 'runner', recordId: 'step', revision: 1,
    occurredAt: at, observedAt: at, adapterVersion: 'test', modelRef: null, reporting: 'delta', inclusion: 'self', coverage: 'complete', validity: 'valid',
    scope: { root: 'root', session: 'root', parentSession: null, ancestors: [], turn: 'missing-turn', turnIndex: 1, level: 'request' }, coveredThroughTurn: null, usage, basis: { kind: 'invocation' },
    projection: { projectionRevision: 1, observedRevision: 1, contribution: usage, coveredThrough: { input: 1, output: 1, cacheRead: 1, cacheWrite: 1 }, complete: true, issues: [] } });
  const f = setup([task([a])], { observations: [observation], nativeCaptures: [nativeSummary(a)] });
  const data = await f.api.systemRuntimeStatistics(actor, query);
  expect(data.metrics.tokens).toMatchObject({ total: '10', complete: false }); expect(data.metrics.reasons).toContain('native-capture-unobserved');
  expect(data.models[0]?.metrics.tokens.complete).toBe(false);
  const revised = { ...nativeSummary(a, 'partial'), historicalRevisionGap: true };
  const detail = await setup([task([a])], { observations: [observation], nativeCaptures: [revised] }).api.systemRuntimeTask(actor, taskId);
  expect(detail.metrics.tokens.total).toBe('10'); expect(detail.metrics.reasons).toContain('native-prior-revision-gap');
});


test('current names remain separate from IDs and accepted revisions in every projection', async () => {
  const a = attempt({ profileName: 'Primary compute', profileRevision: 7 });
  const f = setup([task([a], { projectName: 'Customer workspace' })]);
  const page = await f.api.systemRuntimeStatistics(actor, { ...query, q: 'Customer workspace' });
  expect(page.tasks).toHaveLength(1); expect(page.projects[0]).toMatchObject({ projectId, projectName: 'Customer workspace' });
  expect(page.agents[0]).toMatchObject({ projectName: 'Customer workspace', profileName: 'Primary compute', profileRevision: 7 });
  expect(page.profiles[0]).toMatchObject({ profileId: a.profileId, profileName: 'Primary compute', profileRevision: 7, tasks: [{ taskId }] });
  const detail = await f.api.systemRuntimeTask(actor, taskId);
  expect(detail.projectName).toBe('Customer workspace'); expect(detail.attempts[0]?.profileName).toBe('Primary compute');
});
