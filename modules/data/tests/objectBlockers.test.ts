import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { IDENTITY_HEADERS, TaskIdSchema, type Actor, type ObjectStorageBlocker, type UserId } from '@crewstation/contracts';
import { createApp } from '@crewstation/http';
import { forbidden } from '@crewstation/kernel';
import { createTestDatabase, testDatabaseAvailable, type TestDatabase } from '@crewstation/testkit';
import { objectAdministration } from '../application/objectAdministration';
import { archiveBindingRepository } from '../adapters/persistence/archive/bindings';
import { objectAdminRoutes } from '../http/objectAdminRoutes';
import type { ObjectBackendPlane } from '../ports/objectStorage';
import { dataMigrations } from '../wiring';
import { objectArchiveFixture } from './objectArchiveFixture';
import { objectId } from './objectFixtures';

const available = await testDatabaseAvailable();
let tdb: TestDatabase;
beforeAll(async () => { if (available) tdb = await createTestDatabase([dataMigrations]); });
afterAll(async () => { await tdb?.drop(); });

describe.skipIf(!available)('durable object archive blockers', () => {
  test('newer observations win and pages are isolated by the authorized space before applying the cursor', async () => {
    const f = await objectArchiveFixture(tdb.db), other = await objectArchiveFixture(tdb.db), bindings = archiveBindingRepository(tdb.db);
    const blockers: ObjectStorageBlocker[] = [];
    for (const scope of [f, other, f]) {
      const taskId = TaskIdSchema.parse(objectId()), id = objectId();
      await bindings.prepare({ id, taskId, taskGeneration: 1, spaceId: scope.space.id, volumeUid: objectId(), outcome: 'succeeded', archive: { noArtifactsReason: '无需产物' } }, scope.authority);
      await bindings.confirm(id, 1);
      const value: ObjectStorageBlocker = { taskId, operationId: id, phase: 'draining', code: 'writer_unknown', message: '等待执行停止证明', since: new Date().toISOString() };
      expect(await bindings.observe(id, 1, 2, value)).toBe(true);
      expect(await bindings.observe(id, 1, 1, { ...value, message: 'stale worker' })).toBe(false);
      expect(await bindings.observe(id, 2, 3, null)).toBe(false);
      await expect(bindings.observe(id, 1, 3, { ...value, taskId: TaskIdSchema.parse(objectId()) })).rejects.toThrow('不属于');
      blockers.push(value);
    }
    const owner: Actor = { userId: objectId() as UserId, isAdmin: false };
    const api = objectAdministration({ catalog: f.catalog, reads: f.reads, plane: {} as ObjectBackendPlane,
      authorizer: { authorize: async (actor, id) => { if (!actor.isAdmin && (actor.userId !== owner.userId || id !== f.source.projectId)) throw forbidden(); } } });
    const app = createApp({ name: 'blocker-test' }); app.route('/', objectAdminRoutes(api, async () => false));
    const headers = { [IDENTITY_HEADERS.userId]: owner.userId }, root = `/v3/object-storage/spaces/${f.space.id}/blockers`;
    const first = await (await app.request(`${root}?limit=1`, { headers })).json();
    expect(first).toEqual({ items: [blockers[0]], nextCursor: blockers[0]!.operationId });
    const second = await (await app.request(`${root}?limit=1&cursor=${first.nextCursor}`, { headers })).json();
    expect(second).toEqual({ items: [blockers[2]], nextCursor: null });
    expect((await app.request(`/v3/object-storage/spaces/${other.space.id}/blockers`, { headers })).status).toBe(404);
    expect((await app.request(`/v3/admin/object-storage/backends/${f.backend.id}/blockers`, { headers })).status).toBe(403);
    expect((await app.request(`${root}?cursor=invalid`, { headers })).status).toBe(400);
    expect(await bindings.observe(blockers[0]!.operationId, 1, 3, null)).toBe(true);
    expect((await f.reads.blockers([f.space.id], 100)).items).toEqual([blockers[2]!]);
    const completedId = blockers[0]!.operationId;
    await bindings.receipt(completedId, 1, { receiptId: objectId(), disposition: 'empty', items: [], stopProofDigest: 'a'.repeat(64), completionProofDigest: 'b'.repeat(64) });
    const permit = objectId(); await bindings.permitDeletion(completedId, 1, permit); await bindings.reclaimed(completedId, permit, objectId());
    const historyRoot = `/v3/object-storage/spaces/${f.space.id}/finalizations`;
    const newest = await (await app.request(`${historyRoot}?limit=1`, { headers })).json();
    expect(newest.items).toMatchObject([{ operationId: blockers[2]!.operationId, state: 'bound', receiptId: null }]);
    const older = await (await app.request(`${historyRoot}?limit=1&cursor=${newest.nextCursor}`, { headers })).json();
    expect(older.items).toMatchObject([{ operationId: completedId, state: 'completed' }]); expect(older.items[0].receiptId).not.toBeNull(); expect(older.nextCursor).toBeNull();
    expect((await app.request(`/v3/object-storage/spaces/${other.space.id}/finalizations`, { headers })).status).toBe(404);
    expect((await app.request(`/v3/admin/object-storage/backends/${f.backend.id}/finalizations`, { headers })).status).toBe(403);
  });
});
