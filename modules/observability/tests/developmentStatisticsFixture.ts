import { ExecutionObservationIdentitySchema, RuntimeTaskFactSchema, type Actor, type UsageExecutionIdentity } from '@crewstation/contracts';
import type { TestDatabase } from '@crewstation/testkit';
import { fixedClock, forbidden, jsonHash, newResourceId } from '@crewstation/kernel';
import { createFakeK8sClient } from '@crewstation/k8s';
import { sql } from 'drizzle-orm';
import { createObservabilityModule } from '../wiring';
import { drizzleUsageLedger, drizzleExecutionValuations } from '../adapters/persistence/drizzleUsageLedger';
export const statisticsWindow = { from: '2026-09-30T00:00:00.000Z', to: '2026-10-01T00:00:00.000Z', timezone: 'Asia/Shanghai' };
export const statisticsModel = { provider: 'observed-provider', model: 'actual-model', condition: null };
export async function developmentStatisticsFixture(tdb: TestDatabase, sharedProfile = false) {
  const projectId = newResourceId(), workspaceId = newResourceId(), profileId = newResourceId(), serviceId = newResourceId();
  const facts = Array.from({ length: 2 }, (_, n) => {
    const i = { sourceKind: 'development-agent', projectId, taskId: workspaceId, agentId: newResourceId(), executionId: newResourceId(), executionGeneration: 1 };
    return RuntimeTaskFactSchema.parse({ id: i.executionId, projectId, serviceId, name: i.agentId, protocol: 'development', state: 'closed', createdAt: statisticsWindow.from, closedAt: null, traceId: 'shared-trace', attemptsPartial: false,
      source: { kind: 'development-agent', identity: i, workspaceName: null }, attempts: [{ id: i.agentId, taskId: workspaceId, name: i.agentId, kind: 'agent', state: 'closed', attempt: 1, agentId: i.agentId, executionId: i.executionId,
        profileId: n === 0 || sharedProfile ? profileId : newResourceId(), profileName: n === 0 || sharedProfile ? 'Accepted Compute A' : 'Accepted Compute B', profileRevision: 7, createdAt: statisticsWindow.from, startedAt: null, endedAt: null }] });
  });
  const businessId = newResourceId(), business = RuntimeTaskFactSchema.parse({ id: businessId, projectId, serviceId, name: 'Business task', protocol: 'v3', state: 'closed', createdAt: statisticsWindow.from, closedAt: statisticsWindow.to, traceId: 'shared-trace', attemptsPartial: false,
    attempts: [{ ...facts[0]!.attempts[0]!, id: newResourceId(), taskId: businessId, name: 'Business Agent', executionId: newResourceId(), profileId: newResourceId(), profileName: null, startedAt: statisticsWindow.from, endedAt: statisticsWindow.to }] });
  facts.push(business);
  const admin: Actor = { userId: newResourceId() as Actor['userId'], isAdmin: true }, member: Actor = { ...admin, isAdmin: false };
  const state = { selected: undefined as string[] | undefined, authorized: true, namesAvailable: true, transaction: false };
  const profiles = [...new Map(facts.map((f) => [f.attempts[0]!.profileId!, { id: f.attempts[0]!.profileId!, revision: 7, protocol: 'opencode' as const, name: 'Current renamed Compute', model: 'configured-never-observed' }])).values()];
  const empty = async () => [];
  const module = createObservabilityModule({ db: tdb.db, clock: fixedClock(statisticsWindow.to), k8s: createFakeK8sClient(), isAdmin: async () => true,
    authorizer: { authorize: async (_actor, p) => { if (!state.authorized || p !== projectId) throw forbidden('outside project'); } }, services: { resolveServiceOfProject: async () => undefined }, slots: { slotRoles: async () => undefined }, pricingProfiles: { list: async () => profiles },
    traces: { environments: { traceKeys: empty, activeTraceIds: empty, list: empty }, deliveries: { traceKeys: empty, activeTraceIds: empty, list: empty }, businessTasks: { list: empty }, sessions: { summarize: empty, events: empty } },
    runtimeNames: async () => { if (!state.namesAvailable) throw new Error('directory unavailable'); return { projects: { [projectId]: 'Named project' }, profiles: Object.fromEntries(profiles.map((p) => [p.id, p.name])) }; },
    runtimeTasks: async (tx, q) => { state.transaction = tx !== tdb.db; await tx.execute(sql`SELECT 1`); return { sourceScope: 'project-executions', partial: false, items: facts.filter((f) => (!q.projectId || f.projectId === q.projectId) && (!q.taskId || f.id === q.taskId) && (!state.selected || q.taskId || state.selected.includes(f.id)) && (!q.sourceKind || (f.source?.kind ?? 'business-task') === q.sourceKind)) }; },
  });
  for (const p of profiles) await module.api.savePrice(admin, p.id, { expectedRevision: 0, requestKey: 'price-'+p.id, profileRevision: 7, protocol: 'opencode', ...statisticsModel, currency: 'CNY', rates: { input: '2', output: '0', cacheRead: '0', cacheWrite: '0' }, effectiveFrom: statisticsWindow.to, sourceNote: 'controlled actual model' });
  const feed = async (task: typeof facts[number], input: string, patch: Partial<UsageExecutionIdentity> = {}, priced = true) => {
    const a = task.attempts[0]!, identity = task.source?.kind === 'development-agent' ? { ...task.source.identity, ...patch } : ExecutionObservationIdentitySchema.parse({ projectId: task.projectId, taskId: task.id, subtaskId: a.id, executionId: a.executionId, executionGeneration: a.attempt });
    if (priced) await module.api.acceptExecutionPrice({ identity, profile: { id: a.profileId!, revision: 7, protocol: 'opencode' } });
    const ledger = drizzleUsageLedger(tdb.db), cursor = await ledger.cursor(identity, 'numeric'), next = String(Number(cursor ?? 0)+1);
    await module.api.ingestExecutionUsage({ projectId: identity.projectId, taskId: identity.taskId, sourceId: 'numeric', expectedCursor: cursor, nextCursor: next, events: [{ eventId: 'event-'+next, measurement: { kind: 'usage', identity, sourceId: 'numeric', recordId: 'native-step', revision: 1, occurredAt: statisticsWindow.from, observedAt: statisticsWindow.from, adapterVersion: 'controlled-native/1', modelRef: jsonHash(statisticsModel), reporting: 'delta', inclusion: 'self', coverage: 'complete', validity: 'valid', scope: null, coveredThroughTurn: null, basis: { kind: 'invocation' }, usage: { input, output: '0', cacheRead: '0', cacheWrite: '0' } } }] });
    const measurement = { identity, sourceId: 'numeric', recordId: 'native-step' }, usage = await drizzleExecutionValuations(tdb.db).usage(measurement);
    if (priced) await module.api.valueExecutionUsage({ measurement, usageRevision: usage!.projection.projectionRevision, requestKey: jsonHash(measurement), model: statisticsModel });
    return usage!;
  };
  return { module, facts, projectId, workspaceId, state, admin, member, feed };
}
