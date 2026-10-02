// RFC-034: actual ledger, HTTP endpoints and policy share one PostgreSQL snapshot.
import { afterEach, describe, expect, test } from 'bun:test';
import { ExecutionObservationIdentitySchema, RuntimeTaskFactSchema, SystemRuntimeStatisticsSchema, ProjectRuntimeStatisticsSchema, RuntimeTaskObservationSchema, type UserId } from '@crewstation/contracts';
import { createApp } from '@crewstation/http';
import { createFakeK8sClient } from '@crewstation/k8s';
import { fixedClock, newResourceId } from '@crewstation/kernel';
import { createTestDatabase, testDatabaseAvailable, type TestDatabase } from '@crewstation/testkit';
import { sql, eq } from 'drizzle-orm';
import { createObservabilityModule, observabilityMigrations } from '../wiring';
import { costVisibility } from "../adapters/persistence/tables";
const available = await testDatabaseAvailable(); let tdb: TestDatabase;
afterEach(async () => { await tdb?.drop(); });
async function fixture() {
  tdb = await createTestDatabase([observabilityMigrations]); const projectId = newResourceId(), taskId = newResourceId(), subtaskId = newResourceId(), executionId = newResourceId(), adminId = newResourceId() as UserId;
  const from = '2026-09-28T00:00:00.000Z', to = '2026-09-29T00:00:00.000Z', clock = fixedClock(to);
  const task = RuntimeTaskFactSchema.parse({ id: taskId, projectId, serviceId: newResourceId(), name: 'Live task', protocol: 'v3', state: 'closed', traceId: null, createdAt: from, closedAt: '2026-09-28T00:00:20.000Z', attemptsPartial: false,
    attempts: [{ id: subtaskId, taskId, name: 'Writer', kind: 'agent', state: 'succeeded', attempt: 1, executionId, agentId: newResourceId(), profileId: newResourceId(), profileRevision: 7, createdAt: from, startedAt: from, endedAt: '2026-09-28T00:00:10.000Z' }] });
  const state = { changeVisibility: false, transaction: false, namesOffline: false };
  const module = createObservabilityModule({ db: tdb.db, k8s: createFakeK8sClient(), clock, isAdmin: async (id) => id === adminId, authorizer: { authorize: async () => {} }, services: { resolveServiceOfProject: async () => undefined }, slots: { slotRoles: async () => undefined },
    traces: { environments: { traceKeys: async () => [], activeTraceIds: async () => [], list: async () => [] }, deliveries: { traceKeys: async () => [], activeTraceIds: async () => [], list: async () => [] }, businessTasks: { list: async () => [] }, sessions: { summarize: async () => [], events: async () => [] } },
    runtimeNames: async () => { if (state.namesOffline) throw new Error('Name directory offline'); await tdb.db.execute(sql`SELECT 1`); return { projects: { [projectId]: 'Ledger project' }, profiles: { [task.attempts[0]!.profileId!]: 'Compute Seven' } }; },
    runtimeTasks: async (executor, query) => { state.transaction = executor !== tdb.db; await executor.execute(sql`SELECT 1`);
      if (state.changeVisibility) { state.changeVisibility = false; await tdb.db.update(costVisibility).set({ document: { projectId: task.projectId, revision: 2, visibility: 'project-members-and-services', updatedAt: to } }).where(eq(costVisibility.projectId, projectId)); }
      return { items: query.projectId === undefined || query.projectId === projectId ? [task] : [], partial: false }; },
  });
  const identity = ExecutionObservationIdentitySchema.parse({ projectId: task.projectId, taskId: task.id, subtaskId: task.attempts[0]!.id, executionId: task.attempts[0]!.executionId!, executionGeneration: 1 });
  await module.api.ingestExecutionUsage({ projectId: identity.projectId, taskId: identity.taskId, sourceId: 'runner', expectedCursor: null, nextCursor: '1', events: [{ eventId: 'usage-1', measurement: { kind: 'usage', identity, sourceId: 'runner', recordId: 'first', revision: 1, occurredAt: from, observedAt: from, adapterVersion: 'test', modelRef: null, reporting: 'delta', inclusion: 'self', coverage: 'complete', validity: 'valid', scope: null, coveredThroughTurn: null, basis: { kind: 'invocation' }, usage: { input: '100', output: '5', cacheRead: '0', cacheWrite: '0' } } }] });
  const app = createApp({ name: 'runtime-statistics' }); for (const route of module.http) app.route('/', route);
  return { app, state, task, from, to, headers: { 'x-cs-user-id': adminId }, query: '?from=' + encodeURIComponent(from) + '&to=' + encodeURIComponent(to) };
}
describe.skipIf(!available)('RFC-034 persisted runtime statistics', () => {
  test('system/project totals and task detail come from the committed ledger with distinct projections', async () => {
    const f = await fixture(); const system = await f.app.request('/v1/admin/observability/statistics' + f.query, { headers: f.headers }); expect(system.status).toBe(200);
    const page = SystemRuntimeStatisticsSchema.parse(await system.json()); expect(page.metrics.tokens.total).toBe('105'); expect(page.metrics.cost.amount).toBeNull(); expect(page.models).toHaveLength(1); expect(page.projects[0]?.projectName).toBe('Ledger project'); expect(page.profiles[0]?.profileName).toBe('Compute Seven'); expect(f.state.transaction).toBe(true);
    const project = ProjectRuntimeStatisticsSchema.parse(await (await f.app.request('/v1/projects/' + f.task.projectId + '/observability/statistics' + f.query, { headers: f.headers })).json()); expect(project.metrics.cost.visible).toBe(false); expect(project.profiles[0]?.profileName).toBe('Compute Seven'); expect('models' in project).toBe(false);
    for (const path of ['/v1/admin/observability/tasks/', '/v1/projects/' + f.task.projectId + '/observability/tasks/']) { const detail = RuntimeTaskObservationSchema.parse(await (await f.app.request(path + f.task.id, { headers: f.headers })).json()); expect(detail.attempts[0]?.metrics.tokens.total).toBe('105'); expect(detail.activeUnionMs).toBe(10000); }
    expect((await f.app.request('/v1/admin/observability/statistics?from=invalid', { headers: f.headers })).status).toBe(400);
  });
  test('policy changes committed during the owner read do not drift into the same statistics snapshot', async () => {
    const f = await fixture(); await tdb.db.insert(costVisibility).values({ projectId: f.task.projectId, revision: 1, document: { projectId: f.task.projectId, revision: 1, visibility: 'hidden', updatedAt: f.from } });
    f.state.changeVisibility = true; const path = '/v1/projects/' + f.task.projectId + '/observability/statistics' + f.query;
    const read = async () => ProjectRuntimeStatisticsSchema.parse(await (await f.app.request(path, { headers: f.headers })).json());
    expect((await read()).metrics.cost.visible).toBe(false); expect((await read()).metrics.cost.visible).toBe(true);
  });
  test('temporary name-directory failure retains ledger numbers and explicit unavailable names', async () => {
    const f = await fixture(); f.state.namesOffline = true;
    const response = await f.app.request('/v1/admin/observability/statistics' + f.query, { headers: f.headers });
    expect(response.status).toBe(200); const page = SystemRuntimeStatisticsSchema.parse(await response.json());
    expect(page.metrics.tokens.total).toBe('105'); expect(page.projects[0]?.projectName).toBeUndefined(); expect(page.profiles[0]?.profileName).toBeUndefined();
    const filtered = await f.app.request('/v1/admin/observability/statistics' + f.query + '&q=Ledger%20project', { headers: f.headers });
    expect(filtered.ok).toBe(false); expect(await filtered.json()).toMatchObject({ error: 'precondition', message: '项目名称目录暂不可用，当前搜索无法完成，请稍后重试' });
  });
  test('removed project and system CSV operations return not found', async () => {
    const f = await fixture();
    for (const path of ['/v1/admin/observability/exports', '/v1/projects/' + f.task.projectId + '/observability/exports']) {
      expect((await f.app.request(path, { method: 'POST', headers: f.headers })).status).toBe(404);
    }
  });
});
