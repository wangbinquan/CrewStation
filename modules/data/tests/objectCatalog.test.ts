import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { sql } from 'drizzle-orm';
import { createApp } from '@crewstation/http';
import type { TestDatabase } from '@crewstation/testkit';
import { createTestDatabase, testDatabaseAvailable } from '@crewstation/testkit';
import { dataMigrations } from '../wiring';
import { objectCatalogRepository } from '../adapters/persistence/objectCatalog';
import { backendFixture, controlFixture, objectId, sourceFixture } from './objectFixtures';

const available = await testDatabaseAvailable();
let tdb: TestDatabase;
beforeAll(async () => { if (available) tdb = await createTestDatabase([dataMigrations]); });
afterAll(async () => { await tdb?.drop(); });
const repo = () => objectCatalogRepository(tdb.db);
async function setup() {
  const backend = await repo().registerBackend(backendFixture());
  const source = sourceFixture();
  const plan = await repo().savePlan(objectId(), { name: 'Small', backendId: backend.id, quotaBytes: 6000, maxObjectBytes: 1000, maxConcurrentTransfers: 4, enabled: true });
  await repo().authorizePlans(source.projectId, 1, [plan.id]);
  const input = { ...source, id: objectId(), planId: plan.id, deploymentMode: 'local' as const };
  const observation = { backendId: backend.id, placementRevision: 1, credentialRevision: 1, health: 'ready' as const, freeBytes: 8000, totalBytes: 10000, message: null, observedAt: new Date().toISOString() };
  return { backend, source, plan, input, observation };
}
describe.skipIf(!available)('object catalog with PostgreSQL', () => {
  test('bounded metadata lock contention is retryable HTTP 503, with no partial allocation', async () => {
    const ready = Promise.withResolvers<void>(), release = Promise.withResolvers<void>(), input = backendFixture();
    const held = tdb.db.transaction(async (tx) => { await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtextextended('data.object-storage', 0))`); ready.resolve(); await release.promise; });
    const app = createApp({ name: 'storage-backpressure' }); app.post('/backend', async (c) => c.json(await repo().registerBackend(input)));
    try {
      await ready.promise;
      const busy = await app.request('/backend', { method: 'POST' });
      expect(busy.status).toBe(503); expect(await busy.json()).toMatchObject({ error: 'unavailable', details: { code: 'object_storage_busy' } });
      expect(await repo().backend(input.id)).toBeUndefined();
    } finally { release.resolve(); await held; }
    const admitted = await app.request('/backend', { method: 'POST' }); expect(admitted.status).toBe(200);
    expect((await admitted.json() as { id: string }).id).toBe(input.id);
    expect((await repo().registerBackend(input)).id).toBe(input.id);
  });
  test('concurrent backend retries return one record and preserve JSON objects', async () => {
    const first = backendFixture();
    const records = await Promise.all(Array.from({ length: 5 }, () => repo().registerBackend({ ...first, id: objectId() })));
    expect(new Set(records.map((record) => record.id)).size).toBe(1);
    await expect(repo().registerBackend({ ...first, id: objectId(), requestDigest: 'changed' })).rejects.toThrow('幂等键');
    const [shape] = await tdb.db.execute<{ shape: string }>(sql`SELECT jsonb_typeof(body) AS shape FROM data.object_backends WHERE id = ${records[0]!.id}`);
    expect(shape?.shape).toBe('object');
  });
  test('provisioning requires permission, healthy storage and verified production durability', async () => {
    const { input, observation } = await setup();
    await expect(repo().ensureSpace(input)).rejects.toThrow('尚未就绪');
    await repo().observeBackend(observation);
    await expect(repo().ensureSpace({ ...input, ...sourceFixture() })).rejects.toThrow('未获');
    await expect(repo().ensureSpace({ ...input, deploymentMode: 'production' })).rejects.toThrow('冗余');
    const space = await repo().ensureSpace(input);
    expect((await repo().ensureSpace({ ...input, id: objectId() })).id).toBe(space.id);
    expect((await repo().ensureSpace(input)).revision).toBe(space.revision);
  });
  test('shared backend quota cannot be oversold by two concurrent service releases', async () => {
    const { input, observation } = await setup();
    await repo().observeBackend(observation);
    const results = await Promise.allSettled([repo().ensureSpace(input), repo().ensureSpace({ ...input, id: objectId(), serviceId: sourceFixture().serviceId })]);
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    expect(results.filter((r) => r.status === 'rejected')).toHaveLength(1);
  });
  test('stale physical observations cannot overwrite current revisions; unavailable projects retain their data', async () => {
    const { backend, input, observation } = await setup();
    await repo().observeBackend(observation);
    const space = await repo().ensureSpace(input);
    expect(await repo().observeBackend({ ...observation, credentialRevision: 2, health: 'unavailable' })).toBe(false);
    expect(await repo().observeBackend({ ...observation, observedAt: '2020-01-01T00:00:00.000Z', health: 'unavailable' })).toBe(false);
    await expect(repo().updateBackend(backend.id, { expectedRevision: 1, name: backend.name, state: 'active', budgetBytes: 1 })).rejects.toThrow('预算');
    await repo().updateBackend(backend.id, { expectedRevision: 1, name: backend.name, state: 'offline', budgetBytes: backend.budgetBytes });
    expect((await repo().space(space.id))?.health).toBe('unavailable');
    expect((await repo().space(space.id))?.id).toBe(space.id);
  });
  test('freeze reasons compose; delayed thaw or control messages cannot reopen writes', async () => {
    const { backend, source, input, observation } = await setup();
    await repo().observeBackend(observation);
    const freeze = { id: objectId(), backendId: backend.id, kind: 'backup' as const, epoch: 2, active: true };
    const second = { ...freeze, id: objectId(), kind: 'migration' as const };
    await repo().freeze(freeze); await repo().freeze(second);
    expect(await repo().freeze({ ...freeze, epoch: 1, active: false })).toBe(false);
    await repo().freeze({ ...freeze, active: false });
    await expect(repo().ensureSpace(input)).rejects.toThrow('冻结');
    await repo().freeze({ ...second, active: false });
    expect(await repo().freeze(second)).toBe(false);
    expect((await repo().ensureSpace(input)).id).toBe(input.id);
    const control = controlFixture(source.serviceId, { controlVersion: 2, epoch: 2 });
    expect(await repo().applyWriteControl(control)).toBe(true);
    expect(await repo().applyWriteControl({ ...control, controlVersion: 1 })).toBe(false);
    await expect(repo().applyWriteControl({ ...control, phase: 'frozen' })).rejects.toThrow('幂等键');
  });
});
