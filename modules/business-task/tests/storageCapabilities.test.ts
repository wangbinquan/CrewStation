import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { createTestDatabase, testDatabaseAvailable, type TestDatabase } from '@crewstation/testkit';
import type { BusinessControlDto } from '@crewstation/contracts';
import { newResourceId } from '@crewstation/kernel';
import { businessTaskMigrations } from '../wiring';
import { executionHttpFixture } from './executionHttpFixture';
import type { FinalizationPreparation } from '../ports/storage/preparation';

const unused = async () => { throw new Error('not invoked during task admission'); };
const ports: FinalizationPreparation = {
  preflight: unused,
  operatorArchive: { preflight: unused, createPlan: unused, assessLoss: unused, confirmLoss: unused, deleteArtifacts: unused },
  archive: { permitDeletion: unused, reclaimed: unused, revise: unused, bind: unused, commitArchive: unused, observe: unused },
  runtime: { storageCleanup: { prepare: unused, release: unused, proof: unused, complete: unused }, resolveBusinessStorage: unused, archiveExecution: { ensure: unused, stop: unused }, freezeBusinessStorage: unused, stopBusinessStorage: unused },
};
const available = await testDatabaseAvailable();
describe.skipIf(!available)('storage capability and new-policy HTTP admission', () => {
  let tdb: TestDatabase;
  beforeAll(async () => { tdb = await createTestDatabase([businessTaskMigrations]); });
  afterAll(async () => { await tdb?.drop(); });
  test('requires every finalization port, persistent enablement and ready storage; accepted requests survive a later outage', async () => {
    const f = await executionHttpFixture(tdb.db), instanceId = newResourceId();
    const lease = await (await f.request('/v3/business-execution/control/claim', { instanceId })).json() as BusinessControlDto;
    await f.request('/v3/business-execution/control/activate', { instanceId, expectedEpoch: lease.epoch, leaseId: lease.leaseId, preparationDigest: 'a'.repeat(64) });
    const fence = { instanceId, epoch: lease.epoch, leaseId: lease.leaseId! }, body = { requestKey: newResourceId(), taskContractVersion: 'v1', completionPolicy: 'archive-and-delete', volumeMode: 'persistent', fence };
    let ready = false;
    const status = async () => ({ available: ready, reason: ready ? null : 'object_backend_unavailable' });
    const partial = f.make({ taskStorageStatus: status });
    ready = true;
    expect((await partial.request('/v3/business-tasks', body)).status).toBe(412);
    expect(f.behavior.starts).toBe(0);
    const all = f.make({ finalizationPreparation: ports, taskStorageStatus: status, runner: { ...f.runner, getExecutionCompletionProof: unused } });
    ready = false;
    expect((await all.request('/v3/business-tasks', body)).status).toBe(412);
    expect(await (await all.request('/v3/business-execution/capabilities')).json()).toMatchObject({ storage: { version: 1, finalization: false, unavailableReason: 'object_backend_unavailable' } });
    ready = true;
    const created = await all.request('/v3/business-tasks', body); expect(created.status).toBe(201);
    const value = await created.json(); expect(value).toMatchObject({ completionPolicy: 'archive-and-delete', volumeMode: 'persistent' });
    expect(f.environmentInputs[0]).toMatchObject({ completionPolicy: 'archive-and-delete', volumeMode: 'persistent' });
    expect(await (await all.request('/v3/business-execution/capabilities')).json()).toMatchObject({ storage: { objects: true, finalization: true, taskInputs: false } });
    ready = false;
    expect((await all.request('/v3/business-tasks', body)).status).toBe(200); expect(f.behavior.starts).toBe(1);
    expect((await all.request('/v3/business-tasks', { ...body, requestKey: newResourceId() })).status).toBe(412);
  });
});
