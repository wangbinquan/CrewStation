// RFC-034 v6: real Task terminal/digital/physical facts permit historical compaction.
// Installing the owner port must not substitute an unconditional test permission.
import { afterEach, describe, expect, test } from 'bun:test';
import { ProjectIdSchema } from '@crewstation/contracts';
import { jsonHash } from '@crewstation/kernel';
import { testDatabaseAvailable } from '@crewstation/testkit';
import { sql } from 'drizzle-orm';
import { developmentCleanupFixture } from './developmentCleanupFixture';
import type { DevelopmentCleanupFixture } from './developmentCleanupFixture';

const available = await testDatabaseAvailable();
describe.skipIf(!available)('Task maintenance owner original evidence (real PG)', () => {
  let f: DevelopmentCleanupFixture;
  afterEach(async () => { await f?.close(); });
  const snapshot = async () => {
    const record = (await f.resources.api.get(f.env.id))!;
    return { id: record.id, projectId: record.projectId ?? null, owner: record.owner, kind: record.kind,
      generation: record.generation, version: record.version, retainUntil: record.retainUntil?.toISOString() ?? null,
      phaseSince: record.phaseSince.toISOString(), specHash: jsonHash(record.spec) };
  };
  const inspect = async () => {
    expect(f.runtime.api.inspectResourceEnding).toBeDefined();
    return f.runtime.api.inspectResourceEnding!('compaction', await snapshot());
  };
  async function finishOriginal() {
    await f.runNative();
    const removed = f.wait('finalizer-removed'), controller = f.controller(); controller.observer.start();
    await removed; await controller.reconciled(); await controller.observer.stop();
    await f.runNative(); await f.settle();
  }
  for (const removal of [false, true]) test((removal ? 'new removal-v1' : 'legacy usage-v1 without a new seal') + ' keeps original evidence until actual terminal compaction', async () => {
    f = await developmentCleanupFixture('ledger', true, removal);
    expect(await inspect()).toMatchObject({ status: 'waiting' });
    await finishOriginal();
    const original = await f.load(f.env.id), selected = await snapshot();
    expect(original.native?.state).toBe('finished');
    if (!removal) expect(original.native?.developmentRemovalSeal).toBeUndefined();
    expect(await inspect()).toEqual({ status: 'permitted', snapshot: selected });
    const get = f.safety.get;
    try {
      f.safety.get = async (id) => { const value = await get(id); return value ? { ...value, stopProof: null } : undefined; };
      expect(await inspect()).toMatchObject({ status: 'waiting' });
    } finally { f.safety.get = get; }
    expect(await f.runtime.api.inspectResourceEnding!('retention', selected)).toMatchObject({ status: 'waiting' });
    expect(await f.runtime.api.inspectResourceEnding!('compaction', { ...selected, projectId: ProjectIdSchema.parse(Bun.randomUUIDv7()) })).toMatchObject({ status: 'waiting' });
    expect(await f.runtime.api.inspectResourceEnding!('compaction', { ...selected, specHash: '0'.repeat(64) })).toMatchObject({ status: 'waiting' });
    if (removal) {
      await f.tdb.db.execute(sql`UPDATE task_runtime.environments SET native=native-'developmentRemovalSeal' WHERE id=${f.env.id}`);
      expect(await inspect()).toMatchObject({ status: 'waiting' });
      await f.tdb.db.execute(sql`UPDATE task_runtime.environments SET native=${JSON.stringify(original.native)}::jsonb WHERE id=${f.env.id}`);
    }
    await f.tdb.db.execute(sql`UPDATE task_runtime.environments SET render=jsonb_set(render,'{developmentUsageProtection}','false'::jsonb,true) WHERE id=${f.env.id}`);
    expect(await inspect()).toMatchObject({ status: 'waiting' });
    await f.tdb.db.execute(sql`UPDATE task_runtime.environments SET render=${JSON.stringify(original.render)}::jsonb WHERE id=${f.env.id}`);
    await f.tdb.db.execute(sql`UPDATE resources.records SET phase_since=clock_timestamp()-interval '8 days' WHERE id=${f.env.id}`);
    await f.resources.maintainOnce();
    expect((await f.resources.api.get(f.env.id))?.compactedAt).toBeInstanceOf(Date);
  }, 15000);
});
