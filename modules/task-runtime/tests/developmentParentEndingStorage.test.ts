// Storage-only real PG acceptance: this does not install a parent ending worker or enable the producer.
import { afterEach, describe, expect, test } from 'bun:test';
import { TaskIdSchema } from '@crewstation/contracts';
import { testDatabaseAvailable } from '@crewstation/testkit';
import { sql } from 'drizzle-orm';
import { developmentParentEndingStorageFixture, expectParentStorageRejection } from './developmentParentEndingStorageFixture';
import type { DevelopmentParentEndingStorageFixture } from './developmentParentEndingStorageFixture';

const available = await testDatabaseAvailable();
describe.skipIf(!available)('original parent ending complete fixed membership (real PG)', () => {
  let f: DevelopmentParentEndingStorageFixture;
  afterEach(async () => { await f?.close(); });
  test('all 27 states and raw SQL render shapes remain in the fixed set across a 25-item page', async () => {
    f = await developmentParentEndingStorageFixture(); const ids = await f.seed(27);
    const states = ['creating', 'running', 'paused', 'releasing', 'released', 'failed'];
    for (let i = 0; i < ids.length; i++) await f.db.execute(sql`UPDATE task_runtime.environments SET state=${states[i % states.length]},
      native=jsonb_set(native,'{state}',${JSON.stringify(['queued','starting','running','cleaning','finished'][i % 5])}::jsonb) WHERE id=${ids[i]}`);
    await f.db.execute(sql`UPDATE task_runtime.environments SET render=NULL WHERE id=${ids[0]}`);
    await f.db.execute(sql`UPDATE task_runtime.environments SET render='null'::jsonb WHERE id=${ids[1]}`);
    await f.db.execute(sql`UPDATE task_runtime.environments SET render='false'::jsonb WHERE id=${ids[2]}`);
    await f.db.execute(sql`UPDATE task_runtime.environments SET render=${JSON.stringify('encoded original')}::jsonb WHERE id=${ids[3]}`);
    await f.db.execute(sql`UPDATE task_runtime.environments SET render=render||' {"runtimeConnectionDeadline":1,"runtimeInitializationDeadline":2,"unknownOriginal":true}'::jsonb WHERE id=${ids[26]}`);
    const ending = await f.admit(), first = await f.children.page(ending.id), second = await f.children.page(ending.id, first.at(-1)!.childId);
    expect(ending).toMatchObject({ memberCount: 27, membershipRevision: 1, membershipFrozen: true });
    expect(first).toHaveLength(25); expect(second).toHaveLength(2); expect(await f.children.remaining(ending.id)).toBe(27);
    const all = [...first, ...second]; expect(all.map((c) => c.childId)).toEqual(ids);
    expect(all[0]!.snapshot).toMatchObject({ renderPresent: false, render: null });
    expect(all[1]!.snapshot).toMatchObject({ renderPresent: true, render: null });
    expect(all[2]!.snapshot.render).toBe(false); expect(all[3]!.snapshot.render).toBe('encoded original');
    expect(all[26]!.snapshot.render).toHaveProperty('unknownOriginal', true);
    expect(all[26]!.snapshot.render).not.toHaveProperty('runtimeConnectionDeadline');
    expect(all[26]!.snapshot.render).not.toHaveProperty('runtimeInitializationDeadline');
    expect(new Set(all.map((c) => c.snapshot.state)).size).toBe(6);
    expect(all.every((c) => c.originalParentPodUid === f.parentPod.metadata.uid)).toBe(true);
    expect(await f.children.page(ending.id, ids[26])).toEqual([]);
  });
  test('admission is atomic and fixed membership, original identity and child closure cannot be rewritten', async () => {
    f = await developmentParentEndingStorageFixture(); const ids = await f.seed(2), identity = f.identity();
    await expect(f.admit({ ...identity, epochHash: '0'.repeat(64) })).rejects.toThrow('身份不一致');
    expect(await f.endings.get(identity.id)).toBeUndefined();
    await expect(f.admit({ ...identity, parentId: TaskIdSchema.parse(Bun.randomUUIDv7()) })).rejects.toThrow('身份不一致');
    const ending = await f.admit(identity);
    await expect(f.admit(f.identity())).rejects.toThrow('已有结束受理');
    expect((await f.endings.active(f.parent.id, ending.epochHash))?.id).toBe(ending.id);
    expect((await f.db.transaction((tx) => import('../adapters/persistence/developmentParentEndings').then((m) => m.drizzleDevelopmentParentEndings(tx).get(ending.id, true))))?.id).toBe(ending.id);
    await expectParentStorageRejection(f.db.execute(sql`UPDATE task_runtime.development_parent_endings SET intent='{"replacement":true}'::jsonb WHERE id=${ending.id}`), 'identity is immutable');
    await expectParentStorageRejection(f.db.execute(sql`UPDATE task_runtime.development_parent_endings SET member_count=1 WHERE id=${ending.id}`), 'membership is immutable');
    await expectParentStorageRejection(f.db.execute(sql`DELETE FROM task_runtime.development_parent_ending_children WHERE ending_id=${ending.id}`), 'fixed membership');
    await expectParentStorageRejection(f.db.execute(sql`INSERT INTO task_runtime.development_parent_ending_children(ending_id,child_id,snapshot) VALUES(${ending.id},${Bun.randomUUIDv7()},'{}'::jsonb)`), 'fixed membership');
    await expectParentStorageRejection(f.db.execute(sql`UPDATE task_runtime.development_parent_ending_children SET snapshot='{}'::jsonb WHERE ending_id=${ending.id}`), 'child identity is immutable');
    expect(await f.children.close(ending.id, ids[0]!, { original: true })).toBe(true);
    expect(await f.children.close(ending.id, ids[0]!, { replacement: true })).toBe(false);
    expect(await f.children.remaining(ending.id)).toBe(1); expect((await f.children.page(ending.id)).map((c) => c.childId)).toEqual([ids[1]!]);
    await expectParentStorageRejection(f.db.execute(sql`UPDATE task_runtime.development_parent_ending_children SET closure='{"replacement":true}'::jsonb WHERE ending_id=${ending.id} AND child_id=${ids[0]}`), 'child identity is immutable');
    expect((await f.children.page(ending.id))[0]!.closed).toBe(false);
  });
  test('SQL null is absent and JSON null, scalar and malformed objects are explicit presence', async () => {
    f = await developmentParentEndingStorageFixture();
    for (const raw of ['null', 'false', '"scalar"', '{}']) {
      await f.db.execute(sql`UPDATE task_runtime.environments SET parent_ending=${raw}::jsonb WHERE id=${f.parent.id}`);
      const [row] = await f.db.execute(sql`SELECT parent_ending_present AS present FROM task_runtime.environments WHERE id=${f.parent.id}`);
      expect(row!.present).toBe(true);
    }
    await f.db.execute(sql`UPDATE task_runtime.environments SET parent_ending=NULL WHERE id=${f.parent.id}`);
    const [row] = await f.db.execute(sql`SELECT parent_ending_present AS present FROM task_runtime.environments WHERE id=${f.parent.id}`);
    expect(row!.present).toBe(false);
  });
  test('mutable progress uses the expected original phase; complete witness and old identity stay immutable', async () => {
    f = await developmentParentEndingStorageFixture(); const ending = await f.admit();
    const next = { phase: 'children' as const, status: 'pending' as const, afterChildId: null, progress: {}, completionWitness: null, message: null, retryAt: new Date() };
    expect(await f.endings.progress(ending.id, 'proved', next, new Date())).toBe(false);
    expect(await f.endings.progress(ending.id, ending.phase, next, new Date())).toBe(true);
    expect(await f.endings.progress(ending.id, ending.phase, next, new Date())).toBe(false);
    await expectParentStorageRejection(f.db.execute(sql`UPDATE task_runtime.development_parent_endings SET epoch_hash=${'0'.repeat(64)} WHERE id=${ending.id}`), 'identity is immutable');
    await expectParentStorageRejection(f.db.execute(sql`UPDATE task_runtime.development_parent_endings SET phase='complete',status='complete' WHERE id=${ending.id}`), 'violates check constraint');
    expect(await f.move(ending.id, 'complete')).toBe(true);
    expect(await f.endings.active(f.parent.id, ending.epochHash)).toBeUndefined();
    expect(await f.endings.progress(ending.id, 'complete', next, new Date())).toBe(false);
    await expectParentStorageRejection(f.db.execute(sql`UPDATE task_runtime.development_parent_endings SET completion_witness='{"replacement":true}'::jsonb WHERE id=${ending.id}`), 'completion witness is immutable');
    const final = await f.endings.get(ending.id); expect(final?.completionWitness).toMatchObject({ storageOnly: true, epochHash: ending.epochHash });
    expect((await f.admit()).id).not.toBe(ending.id);
  });
});
