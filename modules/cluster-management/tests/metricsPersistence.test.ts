import { afterEach, describe, expect, test } from 'bun:test';
import { sql } from 'drizzle-orm';
import { IDENTITY_HEADERS, ClusterCapacitySchema, ClusterNodesPageSchema, ClusterUsagePageSchema } from '@crewstation/contracts';
import { createApp } from '@crewstation/http';
import { claimJobs, queueMigrations } from '@crewstation/queue';
import { newResourceId, noopLogger } from '@crewstation/kernel';
import { createTestDatabase, testDatabaseAvailable } from '@crewstation/testkit';
import type { TestDatabase } from '@crewstation/testkit';
import { clusterManagementMigrations } from '../index';
import { drizzleMetricsRepository } from '../adapters/persistence/metricsRepository';
import { METRICS_JOB, STORAGE_JOB } from '../ports/metrics';
import { observeMetrics } from '../application/observeMetrics';
import { metricQueries } from '../application/metricQueries';
import { metricsRoutes, metricsExporter } from '../http/metricsRoutes';
import { metricsWorkers } from '../workers/metricsWorker';
import { metricsFixture } from './metricsFixture';
import { admin } from './inventoryFixture';
const available = await testDatabaseAvailable();
let db: TestDatabase | undefined;
afterEach(async () => { await db?.drop(); db = undefined; });
async function setup() {
  db = await createTestDatabase([queueMigrations, clusterManagementMigrations]); const f = metricsFixture(), repository = drizzleMetricsRepository(db.db); f.deps.repository = repository;
  await Promise.all([repository.schedule('metrics'), repository.schedule('metrics')]);
  const jobs = await claimJobs(db.db, [METRICS_JOB], 'metrics-test', 60, 4); expect(jobs).toHaveLength(1);
  const ticket = { requestId: (jobs[0]!.payload as { requestId: string }).requestId, fence: jobs[0]!.fencingToken }; expect(await repository.claim('metrics', ticket)).toBe(true);
  return { ...f, repository, ticket };
}
describe.skipIf(!available)('resource observation persistence and transport', () => {
  test('fencing, monotonic observations, fixed paging retention and historical identity intervals', async () => {
    const f = await setup(), signal = new AbortController().signal;
    expect(await observeMetrics(f.deps, f.ticket, signal)).toBe(true); const first = (await f.repository.latest())!;
    expect(await f.repository.observation(first.id)).toMatchObject({ id: first.id }); expect(await f.repository.save(first, f.ticket)).toBe(false);
    const nextTicket = { ...f.ticket, fence: f.ticket.fence + 1 }; expect(await f.repository.claim('metrics', nextTicket)).toBe(true);
    f.advance(); const renamed = { ...first, id: newResourceId(), at: f.deps.clock.now().toISOString(), identities: first.identities.map((i) => ({ ...i, name: `renamed-${i.name}`, lastSeen: f.deps.clock.now().toISOString() })) };
    expect(await f.repository.save(renamed, f.ticket)).toBe(false); expect(await f.repository.save(renamed, nextTicket)).toBe(true);
    expect((await f.repository.identities())[0]?.versions).toHaveLength(2);
    f.advance(); expect(await f.repository.save({ ...renamed, id: newResourceId(), at: f.deps.clock.now().toISOString(), identities: [], identitiesComplete: false }, nextTicket)).toBe(true);
    expect((await f.repository.identities()).every((i) => !i.deleted)).toBe(true);
    f.advance(601_000); expect(await f.repository.save({ ...renamed, id: newResourceId(), at: f.deps.clock.now().toISOString(), identities: [] }, nextTicket)).toBe(true);
    expect(await f.repository.observation(first.id)).toBeUndefined(); expect((await f.repository.identities()).every((i) => i.deleted && i.versions.at(-1)?.to)).toBe(true);
    f.advance(9 * 86_400_000); await f.repository.save({ ...renamed, id: newResourceId(), at: f.deps.clock.now().toISOString(), identities: [] }, nextTicket); expect(await f.repository.identities()).toHaveLength(0);
    await f.repository.finish('metrics', nextTicket);
    await db!.db.execute(sql`UPDATE cluster_management.metric_collectors SET requested_at = now() - interval '3 minutes'`); await f.repository.schedule('metrics');
    expect(await f.repository.claim('metrics', f.ticket)).toBe(false); expect(await f.repository.save(renamed, nextTicket)).toBe(false);
  });
  test('storage samples have an independent durable fence and reject late owners', async () => {
    const f = await setup(); await f.repository.schedule('storage'); const job = (await claimJobs(db!.db, [STORAGE_JOB], 'storage-test', 60, 1))[0]!;
    const ticket = { requestId: (job.payload as { requestId: string }).requestId, fence: job.fencingToken }; await f.repository.claim('storage', ticket);
    const samples = [{ uid: f.pvc.metadata.uid!, volumeUid: f.volume.metadata.uid!, metric: { unit: 'bytes' as const, state: 'fresh' as const, value: '4096', source: 'probe' } }];
    expect(await f.repository.saveStorage(samples, f.deps.clock.now().toISOString(), ticket)).toBe(true); expect(await f.repository.storage()).toEqual(samples);
    expect(await f.repository.saveStorage([], f.deps.clock.now().toISOString(), ticket)).toBe(false);
    await f.repository.claim('storage', { ...ticket, fence: 2 }); f.advance(); expect(await f.repository.saveStorage([], f.deps.clock.now().toISOString(), ticket)).toBe(false);
    await f.repository.finish('storage', { ...ticket, fence: 2 });
  });
  test('new admin routes enforce live authorization, schema limits, 410 and independent exporter authentication', async () => {
    const f = await setup(), isAdmin = async (id: string) => id === admin.userId, api = metricQueries(f.deps, isAdmin, { range: async () => [] });
    const app = createApp({ name: 'metrics-test' }); app.route('/', metricsRoutes(api, isAdmin)); app.route('/', metricsExporter(f.deps));
    const headers = { [IDENTITY_HEADERS.userId]: admin.userId };
    expect((await app.request('/v1/admin/cluster/capacity', { headers })).status).toBe(503);
    expect((await app.request('/internal/cluster/metrics', { headers: { authorization: 'Bearer export-token' } })).status).toBe(503);
    await observeMetrics(f.deps, f.ticket, new AbortController().signal); f.advance(); await observeMetrics(f.deps, f.ticket, new AbortController().signal);
    for (const path of ['/capacity', '/nodes', '/usage', '/history/resources', '/history?scope=cluster&from=2026-09-21T09:00:00Z&to=2026-09-21T10:00:00Z']) {
      expect((await app.request(`/v1/admin/cluster${path}`)).status).toBe(401); expect((await app.request(`/v1/admin/cluster${path}`, { headers: { [IDENTITY_HEADERS.userId]: 'ordinary-user' } })).status).toBe(403); expect((await app.request(`/v1/admin/cluster${path}`, { headers })).status).toBe(200);
    }
    ClusterCapacitySchema.parse(await (await app.request('/v1/admin/cluster/capacity', { headers })).json());
    const nodes = ClusterNodesPageSchema.parse(await (await app.request('/v1/admin/cluster/nodes', { headers })).json());
    expect((await app.request(`/v1/admin/cluster/nodes/${nodes.items[0]!.resourceId}`, { headers })).status).toBe(200);
    ClusterUsagePageSchema.parse(await (await app.request('/v1/admin/cluster/usage', { headers })).json());
    expect((await app.request('/v1/admin/cluster/nodes?observationId=expired', { headers })).status).toBe(410);
    expect((await app.request('/v1/admin/cluster/usage?resourceIds=not-a-uuid', { headers })).status).toBe(400);
    expect((await app.request('/internal/cluster/metrics', { headers })).status).toBe(401);
    const metrics = await app.request('/internal/cluster/metrics', { headers: { authorization: 'Bearer export-token' } }); expect(metrics.status).toBe(200); expect(await metrics.text()).toContain('cs_cluster_value');
  });
  test('independent workers execute collection and storage jobs without browser-triggered scans', async () => {
    const f = await setup(); await db!.db.execute(sql`UPDATE platform_infra.jobs SET state = 'pending', lease_until = NULL WHERE kind = ${METRICS_JOB}`);
    const workers = metricsWorkers(f.deps, db!.db, 'metrics-worker-test', noopLogger, async () => []);
    expect(await workers.runOnce()).toBe(1); expect(await f.repository.latest()).toBeDefined();
    await f.repository.schedule('storage'); expect(await workers.runOnce()).toBe(1);
    workers.start(); await workers.stop();
    f.deps.options.enabled = false; workers.start(); await workers.stop();
  });
});
