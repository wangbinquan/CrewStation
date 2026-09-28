import { eq, sql } from 'drizzle-orm';
import { objectBackends } from '../adapters/persistence/objectTables';
import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { createTestDatabase, testDatabaseAvailable, type TestDatabase } from '@crewstation/testkit';
import { dataMigrations } from '../wiring';
import { taskStorageStatus } from '../application/objects/taskStorageStatus';
import { objectArchiveFixture } from './objectArchiveFixture';
import { storageContractRepository } from '../adapters/persistence/objects/contract';
import type { ServiceId } from '@crewstation/contracts';
import { objectId } from './objectFixtures';

const available = await testDatabaseAvailable();
describe.skipIf(!available)('new task storage readiness', () => {
  let tdb: TestDatabase;
  beforeAll(async () => { tdb = await createTestDatabase([dataMigrations]); });
  afterAll(async () => { await tdb?.drop(); });
  test('disabled contract, missing space, stale/offline backend stay unavailable; current usable production storage enables admission', async () => {
    const f = await objectArchiveFixture(tdb.db), contract = storageContractRepository(tdb.db), status = taskStorageStatus(f.catalog, contract);
    expect(await status(f.source.serviceId)).toMatchObject({ available: false, reason: 'storage_contract_unavailable' });
    await contract.enable();
    expect(await status(objectId() as ServiceId)).toMatchObject({ available: false, reason: 'object_space_unavailable' });
    expect(await status(f.source.serviceId)).toEqual({ available: true, reason: null });
    await tdb.db.update(objectBackends).set({ body: sql`${objectBackends.body} || '{"observedAt":"2000-01-01T00:00:00Z"}'::jsonb` }).where(eq(objectBackends.id, f.backend.id));
    expect(await status(f.source.serviceId)).toMatchObject({ available: false, reason: 'object_backend_unavailable' });
    await f.catalog.observeBackend({ backendId: f.backend.id, placementRevision: 1, credentialRevision: 1, health: 'ready', freeBytes: null, totalBytes: null, message: null, observedAt: new Date().toISOString() });
    await f.catalog.updateBackend(f.backend.id, { expectedRevision: 1, state: 'offline', name: f.backend.name, budgetBytes: f.backend.budgetBytes });
    expect(await status(f.source.serviceId)).toMatchObject({ available: false, reason: 'object_backend_unavailable' });
  });
});
