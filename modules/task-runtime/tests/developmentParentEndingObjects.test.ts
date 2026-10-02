// Original physical identities remain distinct from storage-only test witnesses.
import { afterEach, describe, expect, test } from 'bun:test';
import { testDatabaseAvailable } from '@crewstation/testkit';
import { sql } from 'drizzle-orm';
import { developmentParentEndingStorageFixture, expectParentStorageRejection } from './developmentParentEndingStorageFixture';
import type { DevelopmentParentEndingStorageFixture } from './developmentParentEndingStorageFixture';

const available = await testDatabaseAvailable();
describe.skipIf(!available)('original parent Pod and Secret storage (real PG)', () => {
  let f: DevelopmentParentEndingStorageFixture;
  afterEach(async () => { await f?.close(); });
  test('all 27 children close before any original physical identity can be prepared', async () => {
    f = await developmentParentEndingStorageFixture(); const ids = await f.seed(27), ending = await f.admit();
    const object = { endingId: ending.id, kind: 'Pod' as const, namespace: f.parent.namespace, name: f.parent.podName,
      uid: f.parentPod.metadata.uid!, materialsHash: 'a'.repeat(64) };
    await expectParentStorageRejection(f.objects.insert(object), 'preparation is not available');
    expect(await f.move(ending.id, 'children')).toBe(true);
    for (const id of ids.slice(0, 26)) expect(await f.children.close(ending.id, id, { storageOnly: true })).toBe(true);
    expect(await f.children.remaining(ending.id)).toBe(1);
    await expectParentStorageRejection(f.objects.insert(object), 'preparation is not available');
    expect(await f.children.close(ending.id, ids[26]!, { storageOnly: true })).toBe(true);
    expect(await f.children.remaining(ending.id)).toBe(0);
    await f.objects.insert(object); await f.objects.insert(object); expect(await f.objects.list(ending.id)).toHaveLength(1);
    await expect(f.objects.insert({ ...object, uid: crypto.randomUUID() })).rejects.toThrow('不可替换');
    await expect(f.objects.insert({ ...object, materialsHash: 'b'.repeat(64) })).rejects.toThrow('不可替换');
    const secret = { ...object, kind: 'Secret' as const, name: object.name + '-runner', uid: crypto.randomUUID() };
    await f.objects.insert(secret); expect((await f.objects.list(ending.id)).map((o) => o.kind)).toEqual(['Pod', 'Secret']);
    expect(await f.move(ending.id, 'prepared')).toBe(true);
    await expectParentStorageRejection(f.objects.insert({ ...secret, name: secret.name + '-late' }), 'preparation is not available');
  });
  test('absence CAS binds UID and original material; completed absence cannot be rewritten', async () => {
    f = await developmentParentEndingStorageFixture(); const ending = await f.admit(); await f.move(ending.id, 'children');
    const object = { endingId: ending.id, kind: 'Pod' as const, namespace: f.parent.namespace, name: f.parent.podName,
      uid: f.parentPod.metadata.uid!, materialsHash: 'a'.repeat(64) };
    await f.objects.insert(object);
    expect(await f.objects.absent({ ...object, uid: crypto.randomUUID() }, { storageOnly: true })).toBe(false);
    expect(await f.objects.absent({ ...object, materialsHash: 'b'.repeat(64) }, { storageOnly: true })).toBe(false);
    expect(await f.objects.absent(object, { storageOnly: true, originalUid: object.uid })).toBe(true);
    expect(await f.objects.absent(object, { replacement: true })).toBe(false);
    await expectParentStorageRejection(f.db.execute(sql`UPDATE task_runtime.development_parent_ending_objects SET uid=${crypto.randomUUID()} WHERE ending_id=${ending.id}`), 'object identity is immutable');
    await expectParentStorageRejection(f.db.execute(sql`UPDATE task_runtime.development_parent_ending_objects SET absence='{}'::jsonb WHERE ending_id=${ending.id}`), 'object identity is immutable');
    expect((await f.objects.matches('Pod', object.namespace, object.name))[0]?.absence).toMatchObject({ originalUid: object.uid });
    expect(await f.objects.matches('Pod', object.namespace, 'unrelated')).toEqual([]);
  });
  test('historical original physical names return an ambiguous pair rather than selecting an arbitrary generation', async () => {
    f = await developmentParentEndingStorageFixture();
    for (let i = 0; i < 3; i++) {
      const ending = await f.admit(); await f.move(ending.id, 'children');
      await f.objects.insert({ endingId: ending.id, kind: 'Pod', namespace: f.parent.namespace, name: f.parent.podName,
        uid: crypto.randomUUID(), materialsHash: 'a'.repeat(64) });
      await f.move(ending.id, 'complete');
    }
    const matches = await f.objects.matches('Pod', f.parent.namespace, f.parent.podName);
    expect(matches).toHaveLength(2); expect(new Set(matches.map((o) => o.uid)).size).toBe(2);
  });
});
