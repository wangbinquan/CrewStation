import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { createHash } from 'node:crypto';
import { mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { eq } from 'drizzle-orm';
import { ObjectBackupObservationSchema } from '@crewstation/contracts';
import { createTestDatabase, testDatabaseAvailable, type TestDatabase } from '@crewstation/testkit';
import { dataMigrations, createObjectBackupTools } from '../wiring';
import { objectBackupRepository } from '../adapters/persistence/objects/backups';
import { fileBackupBundle } from '../adapters/filesystem/backupBundle';
import { storedObjects } from '../adapters/persistence/objectTables';
import { objectUploadRepository } from '../adapters/persistence/objectUploads';
import { objectArchiveFixture } from './objectArchiveFixture';
import { objectId } from './objectFixtures';
import type { ObjectBytes } from '../ports/objectStorage';
import type { ObjectBackupSink } from '../ports/objectBackups';

const available = await testDatabaseAvailable();
describe.skipIf(!available)('durable object backup freezes and verified copies', () => {
  let tdb: TestDatabase, directory: string;
  beforeEach(async () => { tdb = await createTestDatabase([dataMigrations]); directory = await mkdtemp(join(tmpdir(), 'cs-object-backup-')); });
  afterEach(async () => { await tdb?.drop(); if (directory) await rm(directory, { recursive: true, force: true }); });
  async function fixture() {
    const f = await objectArchiveFixture(tdb.db), bytes = Buffer.alloc(100, 7), digest = createHash('sha256').update(bytes).digest('hex');
    const object = { ...f.object, sha256: digest }; await tdb.db.update(storedObjects).set({ body: object }).where(eq(storedObjects.id, object.id));
    const plane = { get: async () => ({ body: new Blob([bytes]).stream(), size: bytes.length, completed: Promise.resolve({ size: bytes.length, sha256: digest }) }) } as unknown as ObjectBytes;
    const tools = createObjectBackupTools(tdb.db, plane), repo = objectBackupRepository(tdb.db);
    const begin = (key = objectId()) => tools.begin({ requestKey: key, destination: 'independent test destination', reason: 'isolated recovery exercise' });
    const sink = (name: string) => fileBackupBundle({ directory: join(directory, name), snapshot: (path) => writeFile(path, 'test snapshot port; not a real PG dump', { mode: 0o600, flag: 'wx' }) });
    return { ...f, object, bytes, digest, plane, tools, repo, begin, sink };
  }
  test('unknown writers block capture, duplicate starts are fenced, abort releases only its own freeze', async () => {
    const f = await fixture(), uploads = objectUploadRepository(tdb.db);
    const upload = await uploads.reserve(f.space.id, objectId(), { requestKey: objectId(), name: 'late', mediaType: 'text/plain', size: 1, sha256: 'a'.repeat(64) }, f.authority);
    const writer = await uploads.begin(upload.id, objectId(), objectId(), f.authority);
    const key = objectId(), backup = await f.begin(key); expect((await f.begin(key)).id).toBe(backup.id);
    await expect(f.begin()).rejects.toMatchObject({ kind: 'conflict' });
    await expect(f.tools.begin({ requestKey: key, destination: 'changed', reason: 'same key cannot change' })).rejects.toMatchObject({ kind: 'conflict' });
    expect((await f.tools.status(backup.id)).freeze.phase).toBe('draining');
    await expect(f.repo.start(backup.id)).rejects.toMatchObject({ kind: 'precondition' });
    await expect(f.content.reference(f.object.id, { requestKey: objectId(), ownerType: 'application', ownerId: 'x', revision: 1 }, 'active', f.authority)).rejects.toMatchObject({ kind: 'precondition' });
    await uploads.finish(writer.attempt, { receivedBytes: 1, sha256: 'a'.repeat(64) });
    await f.repo.start(backup.id); await expect(f.repo.start(backup.id)).rejects.toMatchObject({ kind: 'conflict' });
    const other = { id: objectId(), kind: 'migration' as const, epoch: 1, backendId: f.backend.id, active: true }; await f.catalog.freeze(other);
    expect((await f.tools.abort(backup.id)).state).toBe('aborted'); expect((await f.tools.abort(backup.id)).state).toBe('aborted');
    expect((await f.catalog.freezeStatus(other.id)).phase).toBe('frozen');
    await expect(f.repo.page(backup.id)).rejects.toMatchObject({ kind: 'conflict' });
    await expect(f.repo.finish(backup.id, { manifestDigest: 'b'.repeat(64), bytes: 100, objectCount: 1 })).rejects.toMatchObject({ kind: 'conflict' });
    expect((await f.repo.observe(f.backend.id)).lastSucceededAt).toBeNull();
  });
  test('only sealed read-back copies update success; failed successor preserves the prior success and immutable objects', async () => {
    const f = await fixture(), first = await f.begin(), sink = await f.sink('successful');
    const result = await f.tools.export(first.id, sink, new AbortController().signal);
    expect(result).toMatchObject({ state: 'succeeded', objectCount: 1, bytes: 100, errorCode: null });
    expect(await readFile(join(directory, 'successful', 'objects', `${f.object.id}.blob`))).toEqual(f.bytes);
    const manifest = await readFile(join(directory, 'successful', 'manifest.json'));
    expect(createHash('sha256').update(manifest).digest('hex')).toBe(result.manifestDigest!);
    expect(JSON.parse(manifest.toString())).toMatchObject({ version: 1, backupId: first.id, objectCount: 1, bytes: 100 });
    await expect(f.sink('successful')).rejects.toThrow(); // no overwrite of any existing destination
    expect((await f.repo.observe(f.backend.id)).lastSucceededAt).toBe(result.completedAt);
    const next = await f.begin(), failed = await f.sink('failed');
    await expect(f.tools.export(next.id, { ...failed, object: async () => { throw new Error('destination full'); } }, new AbortController().signal)).rejects.toThrow('destination full');
    const status = ObjectBackupObservationSchema.parse(await f.repo.observe(f.backend.id));
    expect(status).toMatchObject({ latest: { state: 'failed', errorCode: 'export_failed' }, lastSucceededAt: result.completedAt, lastRestoreVerifiedAt: null });
    expect((await f.tools.status(next.id)).freeze.phase).toBe('released'); expect((await f.reads.object(f.object.id))?.sha256).toBe(f.digest);
    expect(JSON.stringify(status)).not.toContain('requestKey'); expect(JSON.stringify(status)).not.toContain('backendIds');
    expect((await f.repo.observe(objectId())).latest).toBeNull();
  });
  test('digest mismatch, inconsistent inventory and a late exporter cannot publish a success', async () => {
    const f = await fixture(), record = await f.begin(); await f.repo.start(record.id);
    await expect(f.repo.finish(record.id, { manifestDigest: 'b'.repeat(64), objectCount: 0, bytes: 0 })).rejects.toMatchObject({ kind: 'precondition' });
    await f.tools.abort(record.id);
    const next = await f.begin(), sink = await f.sink('invalid');
    const invalid: ObjectBackupSink = { ...sink, object: async () => ({ size: 100, sha256: 'f'.repeat(64) }) };
    await expect(f.tools.export(next.id, invalid, new AbortController().signal)).rejects.toMatchObject({ kind: 'precondition' });
    expect((await f.repo.observe(f.backend.id)).lastSucceededAt).toBeNull();
    const third = await f.begin(); await f.repo.start(third.id); await f.repo.progress(third.id, 1, 100);
    await expect(f.repo.progress(third.id, 0, 0)).rejects.toMatchObject({ kind: 'conflict' });
    await f.tools.abort(third.id); await expect(f.repo.progress(third.id, 1, 100)).rejects.toMatchObject({ kind: 'conflict' });
  });
  test('offline bundle validation rejects wrong manifests, corrupted snapshots and symlinked objects', async () => {
    const f = await fixture(), record = await f.begin();
    const result = await f.tools.export(record.id, await f.sink('reviewed'), new AbortController().signal), path = join(directory, 'reviewed');
    await expect(f.tools.readBundle(path, '0'.repeat(64), new AbortController().signal)).rejects.toMatchObject({ kind: 'precondition' });
    const bundle = await f.tools.readBundle(path, result.manifestDigest!, new AbortController().signal); await bundle.verify();
    const objectPath = join(path, 'objects', `${f.object.id}.blob`); await rm(objectPath); await symlink(join(path, 'platform.pgdump'), objectPath);
    await expect(bundle.verify()).rejects.toMatchObject({ kind: 'precondition' });
    await expect(bundle.content(f.object)).rejects.toMatchObject({ kind: 'precondition' });
    await writeFile(join(path, 'platform.pgdump'), 'corrupted');
    await expect(f.tools.readBundle(path, result.manifestDigest!, new AbortController().signal)).rejects.toMatchObject({ kind: 'precondition' });
  });
});
