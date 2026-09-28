import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { eq } from 'drizzle-orm';
import { OBJECT_STORAGE_LIMITS } from '@crewstation/contracts';
import { createTestDatabase, testDatabaseAvailable, type TestDatabase } from '@crewstation/testkit';
import { dataMigrations } from '../wiring';
import { archivePlans } from '../adapters/persistence/objectTables';
import { archivePlanFile } from '../adapters/persistence/archive/planFile';
import { objectArchiveFixture } from './objectArchiveFixture';
import { objectId, sourceFixture } from './objectFixtures';

const available = await testDatabaseAvailable();
let tdb: TestDatabase;
beforeAll(async () => { if (available) tdb = await createTestDatabase([dataMigrations]); });
afterAll(async () => { await tdb?.drop(); });
const file = (path: string) => ({ kind: 'file' as const, path, name: path, required: true, expectedSize: 20 });
describe.skipIf(!available)('archive plans and protective references', () => {
  test('a 10,000-entry sealed manifest returns only the requested file and preserves selected-object accounting', async () => {
    const f = await objectArchiveFixture(tdb.db), target = { ...file("结果/it's-[last].txt"), expectedSize: undefined };
    const entries = [...Array.from({ length: 9998 }, (_, i) => file(`file-${i}`)), target, { kind: 'object' as const, objectId: f.object.id, name: 'selected-object' }];
    const plan = { ...f.plan, entries, itemCount: entries.length, byteCount: 9998 * 20 + f.object.size, state: 'sealed' as const, digest: 'b'.repeat(64) };
    await tdb.db.update(archivePlans).set({ body: plan }).where(eq(archivePlans.id, plan.id));
    const selected = await archivePlanFile(tdb.db, plan.id, target.path);
    expect(selected).toEqual({ revision: 1, digest: plan.digest, state: 'sealed', entry: { kind: 'file', path: target.path, name: target.name, required: true }, objectBytes: f.object.size });
    expect(Buffer.byteLength(JSON.stringify(selected))).toBeLessThan(1024);
    expect(await f.plans.file(plan.id, target.path)).toEqual(selected!.entry!);
    expect(await f.plans.file(plan.id, 'missing')).toBeUndefined();
    expect(await f.plans.file(plan.id, "' OR true --")).toBeUndefined();
    expect(await f.plans.file(objectId(), target.path)).toBeUndefined();
  });
  test('pages replay across restart, reject gaps, duplicates and changed idempotency bodies, and seal an immutable digest', async () => {
    const f = await objectArchiveFixture(tdb.db), key = objectId();
    expect((await f.plans.create(f.space.id, f.taskId, objectId(), f.plan.requestKey, f.authority)).id).toBe(f.plan.id);
    const input = { requestKey: key, page: 0, expectedRevision: 1, entries: [file('result.txt')] };
    const appended = await f.plans.append(f.plan.id, input, f.authority);
    expect(appended).toMatchObject({ revision: 2, itemCount: 1, byteCount: 20 });
    expect((await f.plans.append(f.plan.id, input, f.authority)).revision).toBe(2);
    await expect(f.plans.append(f.plan.id, { ...input, entries: [file('different.txt')] }, f.authority)).rejects.toThrow('幂等键');
    await expect(f.plans.append(f.plan.id, { ...input, requestKey: objectId(), expectedRevision: 2, page: 2 }, f.authority)).rejects.toThrow('页码');
    await expect(f.plans.append(f.plan.id, { ...input, requestKey: objectId(), expectedRevision: 2, page: 1 }, f.authority)).rejects.toThrow('别名重复');
    const sealed = await f.plans.seal(f.plan.id, key + '-seal', 2, f.authority);
    expect(sealed.state).toBe('sealed'); expect(sealed.digest).toMatch(/^[a-f0-9]{64}$/);
    expect((await f.plans.seal(f.plan.id, key + '-seal', 2, f.authority)).digest).toBe(sealed.digest);
    await expect(f.plans.append(f.plan.id, { ...input, page: 1, expectedRevision: 3, requestKey: objectId(), entries: [file('next')] }, f.authority)).rejects.toThrow('不能追加');
    expect((await f.plans.get(f.plan.id))?.entries).toEqual(input.entries);
  });
  test('object selection pins atomically against deletion, cannot select another service, and explicit abort retires the pin', async () => {
    const f = await objectArchiveFixture(tdb.db);
    const input = { requestKey: objectId(), page: 0, expectedRevision: 1, entries: [{ kind: 'object' as const, objectId: f.object.id, name: 'copy' }] };
    const selected = await f.plans.append(f.plan.id, input, f.authority);
    expect((await f.reads.object(f.object.id))?.referenceCount).toBe(1);
    await expect(f.content.delete(f.object.id, { requestKey: objectId(), expectedRevision: 2 }, f.authority)).rejects.toThrow('引用');
    await expect(f.plans.seal(f.plan.id, objectId(), 2, { source: sourceFixture() })).rejects.toThrow('不存在');
    expect((await f.plans.abort(f.plan.id, selected.revision, f.authority)).state).toBe('aborted');
    expect((await f.reads.object(f.object.id))?.referenceCount).toBe(0);
    expect((await f.plans.append(f.plan.id, input, f.authority)).state).toBe('aborted');
    expect((await f.reads.object(f.object.id))?.referenceCount).toBe(0);
    const g = await objectArchiveFixture(tdb.db);
    await expect(g.plans.append(g.plan.id, { ...input, requestKey: objectId() }, g.authority)).rejects.toThrow('不存在');
  });
  test('concurrent plan pin and delete have one winner, with no leaked plan or reference on rollback', async () => {
    const f = await objectArchiveFixture(tdb.db);
    const result = await Promise.allSettled([
      f.plans.append(f.plan.id, { requestKey: objectId(), page: 0, expectedRevision: 1, entries: [{ kind: 'object', objectId: f.object.id, name: 'report' }] }, f.authority),
      f.content.delete(f.object.id, { requestKey: objectId(), expectedRevision: 1 }, f.authority),
    ]);
    expect(result.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    const plan = await f.plans.get(f.plan.id), object = await f.reads.object(f.object.id);
    if (result[0]!.status === 'fulfilled') { expect(plan?.revision).toBe(2); expect(object?.referenceCount).toBe(1); }
    else { expect(plan?.revision).toBe(1); expect(object?.referenceCount).toBe(0); expect(object?.state).toBe('deleting'); }
  });
  test('blank, unsafe, huge and duplicate-path plans cannot seal or allocate pins; bound plans cannot be abandoned', async () => {
    const f = await objectArchiveFixture(tdb.db);
    await expect(f.plans.seal(f.plan.id, objectId(), 1, f.authority)).rejects.toThrow('noArtifactsReason');
    const input = { requestKey: objectId(), page: 0, expectedRevision: 1, entries: [file('../escape')] };
    await expect(f.plans.append(f.plan.id, input, f.authority)).rejects.toThrow();
    const tooLarge = Array.from({ length: 11 }, (_, i) => ({ ...file(`part-${i}`), expectedSize: OBJECT_STORAGE_LIMITS.objectBytes }));
    await expect(f.plans.append(f.plan.id, { ...input, entries: tooLarge }, f.authority)).rejects.toThrow('总大小');
    const valid = await f.plans.append(f.plan.id, { ...input, requestKey: '__proto__', entries: [file('a')] }, f.authority);
    await expect(f.plans.append(f.plan.id, { ...input, requestKey: objectId(), page: 1, expectedRevision: 2, entries: [{ ...file('a'), name: 'other' }] }, f.authority)).rejects.toThrow('路径重复');
    await tdb.db.update(archivePlans).set({ body: { ...valid, state: 'bound' } }).where(eq(archivePlans.id, valid.id));
    await expect(f.plans.abort(f.plan.id, 2, f.authority)).rejects.toThrow('归属终结');
  });
});
