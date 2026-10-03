import { describe, expect, test } from 'bun:test';
import { testDatabaseAvailable } from '@crewstation/testkit';
import { sql } from 'drizzle-orm';
import { runtimeWorkModuleFixture } from './workModuleFixture';

const available = await testDatabaseAvailable();
describe.skipIf(!available)('TaskRuntime factory original work (actual PG; controlled external ports)', () => {
  test('real module request and scoped transactions create original callbacks; seal blocks new resources while original source reads survive', async () => {
    const f = await runtimeWorkModuleFixture();
    try {
      const result = await f.module.api.createEnvironment({ serviceId: f.service, kind: 'business', volumeMode: 'follow-container' });
      expect(result.state).toBe('creating'); await f.stop();
      const history = await f.work.history(f.project); expect(history.some((row) => row.kind === 'service-api')).toBe(true);
      expect(history.some((row) => row.kind === 'effect')).toBe(true); expect(history.every((row) => row.exited)).toBe(true);
      const before = await f.module.api.originalInfrastructureOwnership('task', result.id), objects = f.k8s.objects.size;
      await f.seal(); await expect(f.module.api.createEnvironment({ serviceId: f.service, kind: 'business' })).rejects.toThrow('永久封闭');
      expect((await f.module.api.getEnvironment(result.id))?.state).toBe('creating');
      await expect(f.module.api.touch(result.id)).rejects.toThrow('永久封闭'); expect(f.k8s.objects.size).toBe(objects);
      expect(await f.module.api.originalInfrastructureOwnership('task', result.id)).toEqual(before);
      expect((await f.module.api.getEnvironment(f.otherParent))?.projectId).toBe(f.otherProject);
      // Global immutable history remains available for platform administrators.
      expect(await f.module.api.imageHistory({ versionIds: [], limit: 20 })).toEqual([]);
    } finally { await f.drop(); }
  });
  test('real reconcile and startup worker skip a closed project before issuing cluster I/O and continue the other project', async () => {
    const f = await runtimeWorkModuleFixture();
    try {
      await f.database.db.execute(sql`UPDATE task_runtime.environments SET state='creating',created_at=clock_timestamp(),updated_at=clock_timestamp()`);
      f.deleting(true); expect(await f.module.api.reconcile()).toBe(0); expect(f.reads).toEqual([f.otherParent]); await f.stop();
      const before = await f.work.history(f.otherProject); expect(before.some((row) => row.kind === 'reconcile')).toBe(true);
      expect(await f.work.history(f.project)).toEqual([]); await f.seal();
      f.reads.length = 0; expect(await f.module.api.reconcile()).toBe(0); expect(f.reads).toEqual([f.otherParent]);
      expect(await f.module.api.observeStartup()).toBe(0); await f.stop();
      expect(await f.work.history(f.project)).toEqual([]); expect((await f.work.history(f.otherProject)).every((row) => row.exited)).toBe(true);
    } finally { await f.drop(); }
  });
});
