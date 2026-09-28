import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { sql } from 'drizzle-orm';
import { createTestDatabase, testDatabaseAvailable, type TestDatabase } from '@crewstation/testkit';
import { dataMigrations } from '../wiring';
import { objectArchiveFixture } from './objectArchiveFixture';
import { objectUploadRepository } from '../adapters/persistence/objectUploads';
import { objectId } from './objectFixtures';

const available = await testDatabaseAvailable();
describe.skipIf(!available)('consistent backup waits for physical mutations', () => {
  let tdb: TestDatabase;
  beforeAll(async () => { tdb = await createTestDatabase([dataMigrations]); });
  afterAll(async () => { await tdb?.drop(); });
  test('unknown PUT does not become quiescent on lease expiry; acknowledged staging can finish while frozen', async () => {
    const f = await objectArchiveFixture(tdb.db), uploads = objectUploadRepository(tdb.db);
    const input = { requestKey: objectId(), name: 'upload', mediaType: 'text/plain', size: 1, sha256: 'a'.repeat(64) };
    const up = await uploads.reserve(f.space.id, objectId(), input, f.authority), claim = await uploads.begin(up.id, objectId(), objectId(), f.authority);
    const freeze = { id: objectId(), backendId: f.backend.id, kind: 'backup' as const, epoch: 1, active: true }; await f.catalog.freeze(freeze);
    expect((await f.catalog.freezeStatus(freeze.id)).blockers).toEqual([{ kind: 'writer', count: 1 }]);
    await uploads.finish(claim.attempt, { errorCode: 'lost', uncertain: true });
    await tdb.db.execute(sql`UPDATE data.object_upload_attempts SET lease_until=now()-interval '1 day' WHERE id=${claim.attempt.id}`);
    await uploads.recoverExpired(); expect((await f.catalog.freezeStatus(freeze.id)).phase).toBe('draining');
    await uploads.finish(claim.attempt, { receivedBytes: 1, sha256: input.sha256 });
    expect((await f.catalog.freezeStatus(freeze.id)).phase).toBe('frozen');
    expect(await uploads.claimVerification(objectId())).toBeUndefined();
    await expect(uploads.reserve(f.space.id, objectId(), { ...input, requestKey: objectId() }, f.authority)).rejects.toThrow('冻结');
  });
  test('already issued DELETE drains but queued deletion never starts during a freeze', async () => {
    const f = await objectArchiveFixture(tdb.db);
    await f.content.delete(f.object.id, { requestKey: objectId(), expectedRevision: 1 }, f.authority);
    const freeze = { id: objectId(), backendId: f.backend.id, kind: 'backup' as const, epoch: 1, active: true }; await f.catalog.freeze(freeze);
    expect(await f.content.claimDelete(objectId())).toBeUndefined(); expect((await f.catalog.freezeStatus(freeze.id)).phase).toBe('frozen');
    await f.catalog.freeze({ ...freeze, active: false });
    const claim = (await f.content.claimDelete(objectId()))!;
    const next = { ...freeze, epoch: 2 }; await f.catalog.freeze(next);
    expect((await f.catalog.freezeStatus(freeze.id)).blockers).toEqual([{ kind: 'object-deletion', count: 1 }]);
    await f.content.failDelete(claim, 'lost-response');
    await tdb.db.execute(sql`UPDATE data.objects SET body=jsonb_set(body,'{deletion,nextRetryAt}',to_jsonb('2000-01-01T00:00:00Z'::text)) WHERE id=${f.object.id}`);
    const retry = (await f.content.claimDelete(objectId()))!; expect(retry.id).toBe(f.object.id);
    await f.content.completeDelete(retry);
    expect((await f.catalog.freezeStatus(freeze.id)).phase).toBe('frozen');
  });
});
