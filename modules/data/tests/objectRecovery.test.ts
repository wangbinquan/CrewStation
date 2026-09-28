import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { sql } from 'drizzle-orm';
import { createTestDatabase, testDatabaseAvailable, type TestDatabase } from '@crewstation/testkit';
import { dataMigrations } from '../wiring';
import { objectArchiveFixture } from './objectArchiveFixture';
import { objectId } from './objectFixtures';
import { objectUploadRepository } from '../adapters/persistence/objectUploads';
import { objectRecoveryRepository } from '../adapters/persistence/objects/recovery';
import { recoverObjectTransfers } from '../application/objects/recovery';
import type { ObjectBackendPlane } from '../ports/objectStorage';

const available = await testDatabaseAvailable();
describe.skipIf(!available)('durable staging recovery never equates expiry or absence with a stopped writer', () => {
  let tdb: TestDatabase;
  beforeEach(async () => { tdb = await createTestDatabase([dataMigrations]); });
  afterEach(async () => { await tdb?.drop(); });
  async function fixture() {
    const f = await objectArchiveFixture(tdb.db), uploads = objectUploadRepository(tdb.db), recovery = objectRecoveryRepository(tdb.db);
    const input = { requestKey: objectId(), name: 'staging', mediaType: 'text/plain', size: 20, sha256: 'a'.repeat(64) };
    const upload = await uploads.reserve(f.space.id, objectId(), input, f.authority);
    const start = () => uploads.begin(upload.id, objectId(), objectId(), f.authority);
    const age = async () => {
      await tdb.db.execute(sql`UPDATE data.object_uploads SET updated_at=now()-interval '2 days',body=jsonb_set(body,'{updatedAt}',to_jsonb('2020-01-01T00:00:00Z'::text)) WHERE id=${upload.id}`);
      await tdb.db.execute(sql`UPDATE data.object_upload_attempts SET body=jsonb_set(body,'{updatedAt}',to_jsonb('2020-01-01T00:00:00Z'::text)) WHERE upload_id=${upload.id}`);
    };
    return { ...f, uploads, recovery, input, upload, start, age };
  }
  test('a lost response is reconciled by positive atomic-write evidence, then still requires full verification', async () => {
    const f = await fixture(), first = await f.start();
    await f.uploads.finish(first.attempt, { uncertain: true, errorCode: 'response_lost' }); await f.uploads.requestCommit(f.upload.id, f.authority);
    const inspecting = (await f.recovery.claimInspection(objectId()))!;
    expect(await f.recovery.claimInspection(objectId())).toBeUndefined();
    expect(await f.recovery.inspected(inspecting)).toBe(true); expect(await f.recovery.inspected(inspecting)).toBe(false);
    expect(await f.uploads.get(f.upload.id)).toMatchObject({ state: 'verifying', objectId: null });
    expect(await f.catalog.backend(f.backend.id)).toMatchObject({ reservedBytes: 120, activeTransfers: 0 });
    expect(await f.uploads.finish(first.attempt, { receivedBytes: 20, sha256: f.input.sha256 })).toBe(false);
    const check = (await f.uploads.claimVerification(objectId()))!;
    expect((await f.uploads.verified(check.attempt, { size: 20, sha256: f.input.sha256 }))?.key).toBe(first.attempt.key);
    await f.age(); expect(await f.recovery.expireIdle()).toBe(0); expect(await f.recovery.claimGarbage(objectId())).toBeUndefined();
  });
  test('unknown/404 stays budgeted, cannot expire, and blocks backup; a late success can drain it', async () => {
    const f = await fixture(), first = await f.start();
    await f.uploads.finish(first.attempt, { uncertain: true, errorCode: 'response_lost' }); await f.age();
    let removes = 0;
    const plane = { inspectWrite: async () => 'unknown', remove: async () => { removes++; } } as unknown as ObjectBackendPlane;
    await recoverObjectTransfers({ recovery: f.recovery, plane, owner: objectId() }, new AbortController().signal);
    expect(removes).toBe(0); expect(await f.recovery.expireIdle()).toBe(0);
    expect(await f.catalog.backend(f.backend.id)).toMatchObject({ reservedBytes: 120, activeTransfers: 1 });
    const freeze = { id: objectId(), backendId: f.backend.id, kind: 'backup' as const, epoch: 1, active: true }; await f.catalog.freeze(freeze);
    expect((await f.catalog.freezeStatus(freeze.id)).phase).toBe('draining');
    await f.uploads.finish(first.attempt, { receivedBytes: 20, sha256: f.input.sha256 });
    expect((await f.catalog.freezeStatus(freeze.id)).phase).toBe('frozen');
    expect(await f.recovery.expireIdle()).toBe(0); expect(removes).toBe(0);
  });
  test('24-hour unused uploads abort once, staging DELETE is replayable, and budgets return only after physical confirmation', async () => {
    const f = await fixture(), first = await f.start();
    await f.uploads.finish(first.attempt, { receivedBytes: 20, sha256: f.input.sha256 });
    expect(await f.recovery.expireIdle()).toBe(0); await f.age();
    expect(await f.recovery.expireIdle()).toBe(1); expect((await f.uploads.get(f.upload.id))?.state).toBe('aborted');
    await expect(f.start()).rejects.toMatchObject({ kind: 'precondition' });
    expect(await f.catalog.space(f.space.id)).toMatchObject({ reservedBytes: 20 });
    const claim = (await f.recovery.claimGarbage(objectId()))!;
    const freeze = { id: objectId(), backendId: f.backend.id, kind: 'backup' as const, epoch: 1, active: true }; await f.catalog.freeze(freeze);
    expect((await f.catalog.freezeStatus(freeze.id)).blockers).toEqual([{ kind: 'object-deletion', count: 1 }]);
    expect(await f.recovery.failGarbage(claim)).toBe(true);
    await tdb.db.execute(sql`UPDATE data.object_upload_attempts SET body=jsonb_set(body,'{recovery,nextRetryAt}',to_jsonb('2020-01-01T00:00:00Z'::text)) WHERE id=${claim.id}`);
    const retry = (await f.recovery.claimGarbage(objectId()))!;
    expect(retry.key).toBe(first.attempt.key); expect(await f.recovery.completeGarbage(claim)).toBe(false);
    expect(await f.recovery.completeGarbage(retry)).toBe(true); expect(await f.recovery.completeGarbage(retry)).toBe(false);
    expect(await f.catalog.space(f.space.id)).toMatchObject({ reservedBytes: 0, usedBytes: 100 });
    expect(await f.catalog.backend(f.backend.id)).toMatchObject({ reservedBytes: 100, activeTransfers: 0 });
    expect((await f.catalog.freezeStatus(freeze.id)).phase).toBe('frozen');
  });
  test('never-started reservations expire; a losing completed attempt cannot change the winning object', async () => {
    const f = await fixture(); await f.age(); expect(await f.recovery.expireIdle()).toBe(1);
    expect(await f.catalog.space(f.space.id)).toMatchObject({ reservedBytes: 0 });
    expect(await f.recovery.expireIdle()).toBe(0);
    const g = await fixture(), first = await g.start(); await g.uploads.finish(first.attempt, { uncertain: true, errorCode: 'lost' });
    const second = await g.start(); await g.uploads.finish(second.attempt, { receivedBytes: 20, sha256: g.input.sha256 });
    await g.uploads.requestCommit(g.upload.id, g.authority); const check = (await g.uploads.claimVerification(objectId()))!;
    const winner = (await g.uploads.verified(check.attempt, { size: 20, sha256: g.input.sha256 }))!;
    const observation = (await g.recovery.claimInspection(objectId()))!; await g.recovery.inspected(observation);
    await g.age();
    await tdb.db.execute(sql`UPDATE data.object_upload_attempts SET body=jsonb_set(body,'{recovery,leaseUntil}',to_jsonb('2020-01-01T00:00:00Z'::text)) WHERE id=${first.attempt.id}`);
    const garbage = (await g.recovery.claimGarbage(objectId()))!; expect(garbage.id).toBe(first.attempt.id);
    await g.recovery.completeGarbage(garbage);
    expect((await g.reads.object(winner.id))?.key).toBe(second.attempt.key);
    expect(await g.catalog.backend(g.backend.id)).toMatchObject({ reservedBytes: 120 });
  });
});
