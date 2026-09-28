import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { createTestDatabase, testDatabaseAvailable, type TestDatabase } from '@crewstation/testkit';
import { dataMigrations } from '../wiring';
import { objectArchiveFixture } from './objectArchiveFixture';
import { objectId } from './objectFixtures';
import { recoverStoppedReads } from '../adapters/persistence/objects/readRecovery';
import { objectUploadRepository } from '../adapters/persistence/objectUploads';

const available = await testDatabaseAvailable();
describe.skipIf(!available)('positive Pod termination recovers durable read occupancy', () => {
  let tdb: TestDatabase;
  beforeAll(async () => { tdb = await createTestDatabase([dataMigrations]); });
  afterAll(async () => { await tdb?.drop(); });
  test('only the stopped Pod loses read leases; tombstones reject late reads and unknown PUTs stay protected', async () => {
    const f = await objectArchiveFixture(tdb.db), uid = objectId(), owner = `${uid}:${objectId()}`, other = `${objectId()}:${objectId()}`;
    const a = await f.content.acquireRead(f.object.id, objectId(), owner, f.source), b = await f.content.acquireRead(f.object.id, objectId(), other, f.source);
    const uploads = objectUploadRepository(tdb.db), upload = await uploads.reserve(f.space.id, objectId(), { requestKey: objectId(), name: 'pending', mediaType: 'text/plain', size: 1, sha256: 'a'.repeat(64) }, f.authority);
    const writer = await uploads.begin(upload.id, objectId(), owner, f.authority); await uploads.finish(writer.attempt, { errorCode: 'connection_lost', uncertain: true });
    expect((await f.catalog.space(f.space.id))?.activeTransfers).toBe(3);
    await recoverStoppedReads(tdb.db, uid, 'a'.repeat(64)); await recoverStoppedReads(tdb.db, uid, 'a'.repeat(64));
    expect((await f.catalog.space(f.space.id))?.activeTransfers).toBe(2);
    expect(await f.content.releaseRead(a.transfer.id, owner)).toBe(false);
    expect(await f.content.releaseRead(b.transfer.id, other)).toBe(true);
    expect((await f.catalog.space(f.space.id))?.activeTransfers).toBe(1);
    await expect(f.content.acquireRead(f.object.id, objectId(), owner, f.source)).rejects.toMatchObject({ kind: 'conflict' });
    expect((await f.reads.queue([f.space.id])).unknownWrites).toBe(1);
  });
});
