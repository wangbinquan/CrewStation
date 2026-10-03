import { describe, expect, test } from 'bun:test';
import type { ReleaseId } from '@crewstation/contracts';
import { newResourceId } from '@crewstation/kernel';
import { testDatabaseAvailable } from '@crewstation/testkit';
import { sql } from 'drizzle-orm';
import { drizzleExecutionControls } from '../../adapters/persistence/executionControl';
import { storageControlOutbox } from '../../adapters/persistence/control-projection/repository';
import { storageSynchronizedControls } from '../../application/storageControl';
import { businessWorkFixture } from './workFixture';

const available = await testDatabaseAvailable();
describe.skipIf(!available)('object control callback cannot acknowledge after losing its original admission (actual PostgreSQL)', () => {
  test('the original held data delivery survives the failed caller; seal preserves its outbox until private finally', async () => {
    const f = await businessWorkFixture(), entered = Promise.withResolvers<void>(), release = Promise.withResolvers<void>();
    let pending: Promise<unknown> | undefined;
    try {
      const raw = drizzleExecutionControls(f.database.db, true), outbox = storageControlOutbox(f.database.db);
      const control = storageSynchronizedControls(raw, outbox, { apply: async () => { entered.resolve(); await release.promise; return true; } }, undefined, f.work);
      pending = control.claim(f.serviceId, { releaseId: newResourceId() as ReleaseId, physicalSlot: 'blue', podUid: newResourceId(), ready: true, role: 'prod' }, { instanceId: newResourceId() });
      const rejected = pending.catch((error: unknown) => error); await entered.promise;
      const [birth] = await f.work.history(f.projectId);
      await f.database.db.execute(sql`SELECT pg_terminate_backend(${birth!.backendPid})`); expect(await rejected).toBeInstanceOf(Error);
      expect(await f.work.seal(f.context())).toEqual({ pending: [birth!.id] });
      const frozen = await raw.read(f.serviceId); release.resolve(); await f.waitExit(birth!.id);
      expect((await raw.read(f.serviceId)).control).toEqual(frozen.control);
      expect(await f.database.db.execute(sql`SELECT service_id FROM business_task.storage_control_outbox WHERE service_id=${f.serviceId}`)).toHaveLength(1);
      expect(await control.syncPending()).toBe(0);
    } finally { release.resolve(); await pending?.catch(() => undefined); await f.drop(); }
  });
});
