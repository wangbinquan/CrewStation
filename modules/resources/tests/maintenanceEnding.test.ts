import { afterEach, describe, expect, test } from 'bun:test';
import { sql } from 'drizzle-orm';
import { testDatabaseAvailable } from '@crewstation/testkit';
import type { Harness } from './fixtures';
import { createHarness, workspace } from './fixtures';

const available = await testDatabaseAvailable();
describe.skipIf(!available)('maintenance owner callback and complete snapshot CAS', () => {
  let h: Harness;
  afterEach(async () => { await h?.database.drop(); });
  async function fixture() {
    h = await createHarness();
    const [row] = await h.database.db.execute(sql`select clock_timestamp()::text as at`);
    h.clock.set(new Date(String(row!.at)));
    const owner = h.module.api.owner('task-runtime'), record = await owner.declare(workspace('ending-cas', { spec: { children: [], developmentParentEnding: { version: 1 } } }));
    await owner.report(record.id, { conditions: [{ type: 'Failed', status: 'true', reason: 'failed', since: new Date(h.clock.now().getTime() - 73 * 3_600_000) }] });
    await h.database.db.execute(sql`update resources.records set retain_until=clock_timestamp()-interval '1 minute' where id=${record.id}`);
    return { owner, record };
  }
  test('selected field without owner handler waits, including malformed presence', async () => {
    const { record } = await fixture();
    await h.module.maintainOnce();
    expect(await h.module.api.get(record.id)).toMatchObject({ desired: 'present', phase: 'failed' });
    expect((await h.module.api.get(record.id))?.compactedAt).toBeUndefined();
  });
  test('an installed owner cannot classify an explicitly selected resource as legacy', async () => {
    const { record } = await fixture();
    h.module.api.registerMaintenanceEndingHandler('task-runtime', async () => ({ status: 'unselected' }));
    await h.module.maintainOnce();
    expect(await h.module.api.get(record.id)).toMatchObject({ desired: 'present', phase: 'failed' });
  });
  test('owner runs outside Resources lock; its changed spec invalidates an old permission', async () => {
    const { owner, record } = await fixture();
    let calls = 0;
    h.module.api.registerMaintenanceEndingHandler('task-runtime', async (_step, snapshot) => {
      calls += 1;
      if (calls === 1) await owner.declare(workspace('ending-cas', { spec: { children: [], developmentParentEnding: { version: 1, revision: 2 } } }));
      return { status: 'permitted', snapshot };
    });
    await h.module.maintainOnce();
    expect(calls).toBe(1);
    expect(await h.module.api.get(record.id)).toMatchObject({ desired: 'present', spec: { developmentParentEnding: { revision: 2 } } });
    await h.module.maintainOnce(); // actual EOF rotates the fixed scan, without resetting another worker's cursor.
    await h.module.maintainOnce();
    expect(calls).toBe(2);
    expect(await h.module.api.get(record.id)).toMatchObject({ desired: 'absent', releaseReason: { code: 'retention-expired' } });
  });
  test('owner already released the resource: do not recount or replace its reason', async () => {
    const { owner, record } = await fixture();
    h.module.api.registerMaintenanceEndingHandler('task-runtime', async (_step, snapshot) => {
      await owner.requestRelease(record.id, { code: 'owner-complete', message: 'actual owner ending' });
      return { status: 'permitted', snapshot };
    });
    await h.module.maintainOnce();
    expect(await h.module.api.get(record.id)).toMatchObject({ desired: 'absent', releaseReason: { code: 'owner-complete' } });
  });
  test('completed selected record keeps details while owner is waiting on its original evidence', async () => {
    const { owner, record } = await fixture();
    await owner.requestRelease(record.id, { code: 'user', message: 'released' });
    await h.database.db.execute(sql`update resources.records set phase_since=clock_timestamp()-interval '8 days' where id=${record.id}`);
    h.module.api.registerMaintenanceEndingHandler('task-runtime', async () => ({ status: 'waiting', reason: 'original-materials-pending' }));
    await h.module.maintainOnce();
    expect((await h.module.api.get(record.id))?.compactedAt).toBeUndefined();
    expect((await h.module.api.get(record.id))?.spec['developmentParentEnding']).toEqual({ version: 1 });
  });
  test('single flight shares the current round and stop waits for its pending callback', async () => {
    await fixture();
    let entered!: () => void, release!: () => void;
    const entry = new Promise<void>((resolve) => { entered = resolve; }), gate = new Promise<void>((resolve) => { release = resolve; });
    let calls = 0, stopped = false;
    h.module.api.registerMaintenanceEndingHandler('task-runtime', async () => { calls += 1; entered(); await gate; return { status: 'waiting', reason: 'ending' }; });
    const first = h.module.maintainOnce();
    await entry;
    expect(h.module.maintainOnce()).toBe(first);
    const stop = h.module.maintenanceWorker.stop().then(() => { stopped = true; });
    await Promise.resolve();
    expect(stopped).toBe(false);
    release(); await first; await stop;
    expect(calls).toBe(1); expect(stopped).toBe(true);
  });
});
