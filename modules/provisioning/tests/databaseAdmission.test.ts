import { describe, expect, test } from 'bun:test';
import { jsonHash, newResourceId } from '@crewstation/kernel';
import { runMigrations, withSharedDatabaseAdmission } from '@crewstation/persistence';
import { testDatabaseAvailable } from '@crewstation/testkit';
import { sql } from 'drizzle-orm';
import { projectWorkFixture } from './projectWorkFixture';

const available = await testDatabaseAvailable();
describe.skipIf(!available)('original provisioning admission belongs to its actual database', () => {
  test('a real lock in a different database cannot authorize forged original birth; upgrade preserves old births and valid same-database finally', async () => {
    const foreign = await projectWorkFixture(),current = await projectWorkFixture({beforePodStopMigration:true}),value = current.create();
    try {
      await current.work.run(value.projectId,value.serviceId,'provision',jsonHash('before-upgrade'),async () => undefined);
      const original = await current.work.history(value.projectId);
      await runMigrations(current.database.db,[current.module.migrations]);
      expect(await current.work.history(value.projectId)).toEqual(original);
      const key = 'provisioning.project-admission:'+value.projectId;
      await withSharedDatabaseAdmission(foreign.database.db,key,async (protectedTx) => {
        const pid = Number((await protectedTx.execute<{pid:number}>(sql`SELECT pg_backend_pid() AS pid`))[0]!.pid);
        await current.database.db.transaction(async (tx) => {
          await tx.execute(sql`SELECT set_config('crewstation.shared_admission_pid',${String(pid)},true),set_config('crewstation.shared_admission_keys',${JSON.stringify([key])},true)`);
          const row = (await tx.execute<{accepted:boolean; foreign_lock:boolean; local_lock:boolean}>(sql`SELECT provisioning.admitted(${value.projectId},${pid}) AS accepted,
            EXISTS(SELECT 1 FROM pg_locks WHERE pid=${pid} AND locktype='advisory' AND granted AND mode='ShareLock'
              AND database<>(SELECT oid FROM pg_database WHERE datname=current_database())) AS foreign_lock,
            EXISTS(SELECT 1 FROM pg_locks WHERE pid=${pid} AND locktype='advisory' AND granted AND mode='ShareLock'
              AND database=(SELECT oid FROM pg_database WHERE datname=current_database())) AS local_lock`))[0]!;
          expect(row.foreign_lock).toBe(true); expect(row.local_lock).toBe(false); expect(row.accepted).toBe(false);
        });
        await expect(current.database.db.transaction(async (tx) => {
          await tx.execute(sql`SELECT set_config('crewstation.shared_admission_pid',${String(pid)},true),set_config('crewstation.shared_admission_keys',${JSON.stringify([key])},true)`);
          await tx.execute(sql`INSERT INTO provisioning.original_callbacks(id,project_id,service_id,kind,consumer_id,backend_pid,original_process,input_digest,exit_key_hash)
            VALUES(${newResourceId()},${value.projectId},${value.serviceId},'provision',${newResourceId()},${pid},${JSON.stringify(current.native)}::jsonb,${jsonHash('forged')},${jsonHash('guessed')})`);
        })).rejects.toMatchObject({cause:{message:expect.stringContaining('actual admitted')}});
      });
      expect(await current.work.history(value.projectId)).toEqual(original);
      await current.work.run(value.projectId,value.serviceId,'enqueue',jsonHash('after-upgrade'),async () => undefined);
      const history = await current.work.history(value.projectId);
      expect(history).toHaveLength(2); expect(history.every((row) => row.exited && row.exitDigest && row.recoveryDigest===null)).toBe(true);
    } finally {await Promise.allSettled([foreign.drop(),current.drop()]);}
  });
});
