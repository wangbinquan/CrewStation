import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { sql } from 'drizzle-orm';
import { createTestDatabase, testDatabaseAvailable, type TestDatabase } from '@crewstation/testkit';
import { dataMigrations } from '../wiring';
import { storageContractRepository } from '../adapters/persistence/objects/contract';
import { objectCatalogRepository } from '../adapters/persistence/objectCatalog';
import { backendFixture, objectId, sourceFixture } from './objectFixtures';

const available = await testDatabaseAvailable();
describe.skipIf(!available)('persistent storage contract protects restart, admission and rollback', () => {
  let tdb: TestDatabase;
  beforeAll(async () => { tdb = await createTestDatabase([dataMigrations]); });
  afterAll(async () => { await tdb?.drop(); });
  test('provisioning waits for activation; activated metadata rejects lower supported versions and persists across process instances', async () => {
    const contract = storageContractRepository(tdb.db), catalog = objectCatalogRepository(tdb.db, { requireContract: true }), source = sourceFixture();
    expect(await contract.check()).toEqual({ requiredVersion: 0, enabled: false });
    const backend = await catalog.registerBackend(backendFixture({ health: 'ready' })), plan = await catalog.savePlan(objectId(), { name: 'contract test', backendId: backend.id, quotaBytes: 1000, maxObjectBytes: 100, maxConcurrentTransfers: 1, enabled: true });
    await catalog.authorizePlans(source.projectId, 1, [plan.id]); const input = { ...source, id: objectId(), planId: plan.id, deploymentMode: 'local' as const };
    await expect(catalog.ensureSpace(input)).rejects.toMatchObject({ details: { code: 'storage_contract_unavailable' } });
    await contract.enable(); await contract.enable(); expect((await catalog.ensureSpace(input)).id).toBe(input.id);
    expect(await storageContractRepository(tdb.db).check()).toEqual({ requiredVersion: 1, enabled: true });
    await expect(contract.check(0)).rejects.toMatchObject({ details: { code: 'storage_contract_incompatible' } });
    await tdb.db.execute(sql`UPDATE data.storage_contract SET required_version=2`);
    await expect(contract.check()).rejects.toMatchObject({ details: { code: 'storage_contract_incompatible' } });
    await expect(contract.enable()).rejects.toThrow('版本高于');
    await tdb.db.execute(sql`DELETE FROM data.storage_contract`);
    await expect(contract.check()).rejects.toMatchObject({ details: { code: 'storage_contract_unknown' } });
  });
});
