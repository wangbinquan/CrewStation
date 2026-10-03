import { describe, expect, test } from 'bun:test';
import { PROJECT_DELETION_PHASES } from '@crewstation/contracts';
import { jsonHash, newResourceId } from '@crewstation/kernel';
import { testDatabaseAvailable } from '@crewstation/testkit';
import { sql } from 'drizzle-orm';
import { businessOwnerFixture } from './ownerFixture';

const available = await testDatabaseAvailable();
describe.skipIf(!available)('legacy original callback proofs gate business deletion (actual PostgreSQL)', () => {
  test('an old unlinked ticket blocks stop and metadata even if intermediate records are supplied', async () => {
    const f = await businessOwnerFixture();
    try {
      await f.seed();
      await f.database.db.execute(sql`INSERT INTO business_task.legacy_mutations(id,service_id,kind,state) VALUES(${newResourceId()},${f.serviceId},'old-effect','unknown')`);
      const inventory = await f.owner().inspect(f.target);
      expect((await f.owner().run(f.context(inventory))).kind).toBe('done');
      expect((await f.owner().run(f.context(inventory, 'stop'))).kind).toBe('waiting');
      const evidence = { kind: 'metadata' as const, count: 0, digest: jsonHash('controlled intermediate record'), description: 'Controlled intermediate record is not an original callback exit.' };
      for (const phase of PROJECT_DELETION_PHASES.slice(1, 5)) await f.repo().record(f.context(inventory, phase), evidence);
      await expect(f.repo().purge(f.context(inventory, 'metadata'))).rejects.toThrow('旧协议在途票据');
      expect((await f.repo().inspect(f.target)).scope.count).toBeGreaterThan(0);
    } finally { await f.drop(); }
  });

  test('only the same actual admitted legacy callback can link a ticket, and its private finally permits unknown-result cleanup', async () => {
    const f = await businessOwnerFixture();
    try {
      await f.seed();
      await f.work.run({ ...f.input(), kind: 'legacy-api' }, async () => {
        const callback = f.work.callbackId();
        await f.database.db.transaction((tx) => tx.execute(sql`INSERT INTO business_task.legacy_mutations(id,service_id,kind,state,callback_id) VALUES(${newResourceId()},${f.serviceId},'lost-result','unknown',${callback})`));
        await expect(f.database.db.transaction((tx) => tx.execute(sql`INSERT INTO business_task.legacy_mutations(id,service_id,kind,state,callback_id) VALUES(${newResourceId()},${f.otherService},'wrong-service','unknown',${callback})`))).rejects.toThrow();
      });
      const birth = (await f.work.history(f.projectId)).find((row) => row.kind === 'legacy-api')!;
      expect(birth.exited).toBe(true);
      await expect(f.database.db.execute(sql`INSERT INTO business_task.legacy_mutations(id,service_id,kind,state,callback_id) VALUES(${newResourceId()},${f.serviceId},'late-link','unknown',${birth.id})`).then(() => undefined)).rejects.toThrow();
      const inventory = await f.owner().inspect(f.target);
      for (const phase of PROJECT_DELETION_PHASES) expect((await f.owner().run(f.context(inventory, phase))).kind).toBe('done');
      expect((await f.owner().inspect(f.target)).resources).toEqual([]);
    } finally { await f.drop(); }
  });
});
