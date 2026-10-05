import { describe, expect, test } from 'bun:test';
import { NATIVE_REGISTRY_ADMISSION } from '@crewstation/contracts';
import { jsonHash, newResourceId } from '@crewstation/kernel';
import { assertSharedDatabaseAdmissionActive, withExclusiveDatabaseAdmission } from '@crewstation/persistence';
import { testDatabaseAvailable } from '@crewstation/testkit';
import { sql } from 'drizzle-orm';
import { runtimeImageProjectAdmissions, runtimeImageUnitOfWork } from '../adapters/persistence/unitOfWork';
import { RuntimeImageCallbackRecordSchema } from '../domain/records';
import { runtimeImageCallbackContent } from '../adapters/persistence/lifecycleRepositories';
import { runtimeImageFixture } from './runtimeImageFixture';

const original = { podUid: '91754092-388a-4131-a452-f9d4b75f0766', nodeUid: '8acdd9b0-3dd8-4a8a-afdf-a1d90a17cf1a', nodeName: 'original-node', containerId: 'containerd://' + 'a'.repeat(64) };
const available = await testDatabaseAvailable();

describe.skipIf(!available)('native registry actual global admission', () => {
  test('the native journal check runs inside actual shared admission before catalog writes or callback birth', async () => {
    const f = await runtimeImageFixture(); let blocked = true, checks = 0, changed = false;
    const assertNativeRegistryAvailable = async () => {
      assertSharedDatabaseAdmissionActive(f.tdb.db, NATIVE_REGISTRY_ADMISSION); checks++;
      if (blocked) throw Error('original native reclamation still runs');
    };
    const admissions = runtimeImageProjectAdmissions({ db: f.tdb.db, assertNativeRegistryAvailable, protectCurrent: async () => original, assertAvailable: async () => {} });
    const uow = runtimeImageUnitOfWork(f.tdb.db, assertNativeRegistryAvailable);
    const callback = { kind: 'build' as const, id: newResourceId(), inputDigest: jsonHash('platform-build') };
    try {
      await expect(uow.run(async () => { changed = true; })).rejects.toThrow('still runs');
      await expect(admissions.run([], callback, async () => { changed = true; })).rejects.toThrow('still runs');
      expect(changed).toBe(false); expect(checks).toBe(2);
      expect(await f.tdb.db.execute(sql`SELECT id FROM runtime_environment.deletion_callbacks`)).toHaveLength(0);
      blocked = false;
      await uow.run(async () => { changed = true; });
      await admissions.run([], callback, async () => { await admissions.check([]); });
      expect(changed).toBe(true); expect(checks).toBe(4);
      expect((await f.tdb.db.execute<{ exited: boolean }>(sql`SELECT exited_at IS NOT NULL AS exited FROM runtime_environment.deletion_callbacks`))[0]!.exited).toBe(true);
    } finally { await f.tdb.drop(); }
  });
  test('a platform build without a project has a durable original callback and excludes reclamation until finally', async () => {
    const f = await runtimeImageFixture(), entered = Promise.withResolvers<void>(), release = Promise.withResolvers<void>();
    const admissions = runtimeImageProjectAdmissions({ db: f.tdb.db, protectCurrent: async () => original, assertAvailable: async () => { throw Error('platform work has no project'); } });
    const pending = admissions.run([], { kind: 'build', id: newResourceId(), inputDigest: jsonHash('platform-build') }, async () => {
      await admissions.check([]); entered.resolve(); await release.promise; await admissions.check([]);
    });
    try {
      await entered.promise;
      const rows = await f.tdb.db.execute<{ body: Record<string, unknown> }>(sql`SELECT to_jsonb(c) AS body FROM runtime_environment.deletion_callbacks c`);
      expect(rows).toHaveLength(1);
      const birth = runtimeImageCallbackContent(rows[0]!.body);
      expect(birth.success).toBe(true);
      if (!birth.success) throw Error('original callback was not retained');
      expect(RuntimeImageCallbackRecordSchema.parse(birth.data).originalProjectIds).toEqual([]);
      expect(birth.data.exited).toBe(false);
      const excluded = withExclusiveDatabaseAdmission(f.tdb.db, NATIVE_REGISTRY_ADMISSION, async () => 'drained');
      // Observe the real waiting exclusive lock, rather than relying on a timer.
      for (let i = 0; i < 100; i++) {
        const waiting = (await f.tdb.db.execute<{ waiting: boolean }>(sql`SELECT EXISTS(SELECT 1 FROM pg_locks WHERE locktype='advisory' AND mode='ExclusiveLock' AND NOT granted
          AND classid=((hashtextextended(${NATIVE_REGISTRY_ADMISSION},0)>>32)&4294967295)::oid AND objid=(hashtextextended(${NATIVE_REGISTRY_ADMISSION},0)&4294967295)::oid) AS waiting`))[0]!.waiting;
        if (waiting) break;
        if (i === 99) throw Error('native exclusive admission did not wait');
        await Bun.sleep(10);
      }
      release.resolve(); await pending;
      expect(await excluded).toBe('drained');
      const ended = await f.tdb.db.execute<{ body: Record<string, unknown> }>(sql`SELECT to_jsonb(c) AS body FROM runtime_environment.deletion_callbacks c`);
      const receipt = runtimeImageCallbackContent(ended[0]!.body);
      expect(receipt.success).toBe(true);
      if (receipt.success) { expect(receipt.data.exited).toBe(true); expect(receipt.data.originalProjectIds).toEqual([]); expect(receipt.data.exitDigest).toMatch(/^[a-f0-9]{64}$/); }
      const remove = async () => {
        try { await f.tdb.db.execute(sql`DELETE FROM runtime_environment.deletion_callbacks`); }
        catch (error) { throw error instanceof Error && error.cause ? error.cause : error; }
      };
      await expect(remove()).rejects.toThrow('Platform callback birth cannot be removed');
    } finally { release.resolve(); await pending.catch(() => {}); await f.tdb.drop(); }
  }, 20_000);

  test('catalog transactions wait for the actual native exclusive admission', async () => {
    const f = await runtimeImageFixture(), entered = Promise.withResolvers<void>(), release = Promise.withResolvers<void>();
    const fence = withExclusiveDatabaseAdmission(f.tdb.db, NATIVE_REGISTRY_ADMISSION, async () => { entered.resolve(); await release.promise; });
    try {
      await entered.promise;
      let changed = false;
      const candidate = f.uow.run(async () => { changed = true; });
      for (let i = 0; i < 100; i++) {
        const waiting = (await f.tdb.db.execute<{ waiting: boolean }>(sql`SELECT EXISTS(SELECT 1 FROM pg_locks WHERE locktype='advisory' AND mode='ShareLock' AND NOT granted
          AND classid=((hashtextextended(${NATIVE_REGISTRY_ADMISSION},0)>>32)&4294967295)::oid AND objid=(hashtextextended(${NATIVE_REGISTRY_ADMISSION},0)&4294967295)::oid) AS waiting`))[0]!.waiting;
        if (waiting) break;
        if (i === 99) throw Error('catalog pin transaction did not wait');
        await Bun.sleep(10);
      }
      expect(changed).toBe(false);
      release.resolve(); await fence; await candidate; expect(changed).toBe(true);
      expect((await f.tdb.db.execute<{ admitted: boolean }>(sql`SELECT runtime_environment.native_registry_admitted() AS admitted`))[0]!.admitted).toBe(false);
      await f.tdb.db.transaction(async tx => {
        await tx.execute(sql`SELECT set_config('crewstation.shared_admission_pid',pg_backend_pid()::text,true)`);
        expect((await tx.execute<{ admitted: boolean }>(sql`SELECT runtime_environment.native_registry_admitted() AS admitted`))[0]!.admitted).toBe(false);
      });
    } finally { release.resolve(); await fence.catch(() => {}); await f.tdb.drop(); }
  }, 20_000);
});
