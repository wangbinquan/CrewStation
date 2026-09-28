import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { createHash } from 'node:crypto';
import { mkdtemp, open, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { eq, sql } from 'drizzle-orm';
import { createTestDatabase, testDatabaseAvailable, type TestDatabase } from '@crewstation/testkit';
import { createObjectBackupTools, dataMigrations } from '../wiring';
import { objectBackupRepository } from '../adapters/persistence/objects/backups';
import { storedObjects } from '../adapters/persistence/objectTables';
import { objectArchiveFixture } from './objectArchiveFixture';
import { objectId } from './objectFixtures';
import { garageAvailable, startGarage } from '../../data-control/tests/garageFixture';
import { createObjectStoragePlane, dataControlMigrations } from '../../data-control';
import { generateSecretKey } from '@crewstation/secretbox';
import { s3ObjectPlane } from '../../data-control/adapters/http/s3Objects';
import { objectReadRepository } from '../adapters/persistence/objectReads';

const available = await testDatabaseAvailable() && garageAvailable, secretKey = generateSecretKey();
let source: TestDatabase, restored: TestDatabase, garage: Awaited<ReturnType<typeof startGarage>>, target: Awaited<ReturnType<typeof startGarage>>, directory: string;
beforeAll(async () => {
  if (!available) return;
  source = await createTestDatabase([dataMigrations, dataControlMigrations]); restored = await createTestDatabase([]);
  await restored.db.execute(sql`DROP SCHEMA platform_infra CASCADE`); // Remove only the fresh fixture's empty migration ledger.
  garage = await startGarage(); target = await startGarage(); directory = await mkdtemp(join(tmpdir(), 'cs-backup-real-'));
}, 120_000);
afterAll(async () => { await garage?.dispose(); await target?.dispose(); await source?.drop(); await restored?.drop(); if (directory) await rm(directory, { recursive: true, force: true }); }, 30_000);

/** Disposable PostgreSQL 17 client; credentials stay in inherited environment, never argv. */
async function postgresClient(databaseUrl: string, action: 'dump' | 'restore', path: string) {
  const url = new URL(databaseUrl); if (process.platform === 'darwin' && ['localhost', '127.0.0.1'].includes(url.hostname)) url.hostname = 'host.docker.internal';
  const stream = await open(path, action === 'dump' ? 'wx' : 'r', 0o600);
  try {
    const proc = Bun.spawn(['docker', 'run', '--rm', ...(action === 'restore' ? ['-i'] : []), ...(process.platform === 'linux' ? ['--network', 'host'] : []), '--read-only', '--cap-drop', 'ALL', '--security-opt', 'no-new-privileges', ...['PGDATABASE', 'PGHOST', 'PGPORT', 'PGUSER', 'PGPASSWORD'].flatMap((key) => ['-e', key]), 'postgres:17.11',
      action === 'dump' ? 'pg_dump' : 'pg_restore', ...(action === 'dump' ? ['--format=custom'] : ['--dbname', url.pathname.slice(1), '--single-transaction', '--exit-on-error']), '--no-owner', '--no-privileges'],
    { env: { ...process.env, PGDATABASE: url.pathname.slice(1), PGHOST: url.hostname, PGPORT: url.port || '5432', PGUSER: decodeURIComponent(url.username), PGPASSWORD: decodeURIComponent(url.password) }, stdin: action === 'restore' ? stream.fd : 'ignore', stdout: action === 'dump' ? stream.fd : 'ignore', stderr: 'pipe' });
    const errors = new Response(proc.stderr).text(); const code = await proc.exited, detail = await errors;
    if (code) throw new Error(`Isolated PostgreSQL ${action} failed (${code}): ${detail.replaceAll(decodeURIComponent(url.password), '[redacted]').replaceAll(url.toString(), '[redacted]').slice(0, 3000)}`);
    if (action === 'dump') await stream.sync();
  } finally { await stream.close(); }
}

describe.skipIf(!available)('real PostgreSQL snapshot and independent Garage recovery', () => {
  test('frozen snapshot, every referenced byte and digest survive export, empty-database restore and a separate object backend', async () => {
    const f = await objectArchiveFixture(source.db), payload = Buffer.alloc(100, 9), sha256 = createHash('sha256').update(payload).digest('hex');
    const object = { ...f.object, sha256 }; await source.db.update(storedObjects).set({ body: object }).where(eq(storedObjects.id, object.id));
    await f.content.reference(object.id, { requestKey: objectId(), ownerType: 'application', ownerId: 'verified-backup', revision: 1 }, 'active', f.authority);
    const plane = createObjectStoragePlane(source.db, secretKey), destination = s3ObjectPlane({ endpoint: async () => target.config });
    await plane.configure(f.backend.id, f.backend.placementRevision, f.backend.credentialRevision, garage.config);
    await plane.put(object, { body: new Blob([payload]).stream(), size: payload.length, sha256, signal: new AbortController().signal });
    const tools = createObjectBackupTools(source.db, plane), record = await tools.begin({ requestKey: objectId(), destination: 'independent fixture', reason: 'restore proof' });
    const bundlePath = join(directory, 'complete');
    const sink = await tools.fileBundle({ directory: bundlePath, snapshot: (path) => postgresClient(source.url, 'dump', path) });
    const result = await tools.export(record.id, sink, new AbortController().signal); expect(result.state).toBe('succeeded');
    const bundle = await tools.readBundle(bundlePath, result.manifestDigest!, new AbortController().signal); await bundle.verify();
    await expect(tools.verifyRestore(bundle, result.manifestDigest!, new AbortController().signal)).rejects.toMatchObject({ kind: 'precondition', details: { code: 'object_restore_source_database' } });
    await postgresClient(restored.url, 'restore', join(bundlePath, 'platform.pgdump'));
    const restoredTools = createObjectBackupTools(restored.db, destination);
    expect((await restoredTools.status(record.id)).freeze.phase).toBe('frozen');
    for await (const item of bundle.entries()) {
      expect(await destination.inspectWrite(item, new AbortController().signal)).toBe('unknown');
      await destination.put(item, { body: await bundle.content(item), size: item.size, sha256: item.sha256, signal: new AbortController().signal });
      expect(await destination.verify(item, new AbortController().signal, item)).toEqual({ size: item.size, sha256: item.sha256 });
      expect(await objectReadRepository(restored.db).object(item.id)).toMatchObject({ id: object.id, sha256, referenceCount: 1 });
    }
    await restoredTools.verifyRestore(bundle, result.manifestDigest!, new AbortController().signal);
    const observed = await objectBackupRepository(restored.db).observe(f.backend.id);
    expect(observed.latest?.state).toBe('restore-verified'); expect(observed.lastRestoreVerifiedAt).not.toBeNull();
    expect((await objectBackupRepository(source.db).observe(f.backend.id)).lastSucceededAt).toBe(result.completedAt);
    await expect(restoredTools.abort(record.id)).rejects.toMatchObject({ kind: 'precondition' });
    const operational = createObjectBackupTools(restored.db, createObjectStoragePlane(restored.db, secretKey));
    const restoreInput = { bundle, manifestDigest: result.manifestDigest!, requestKey: objectId(), destinations: [{ backendId: f.backend.id, ...target.config }] };
    await expect(operational.restore!({ ...restoreInput, destinations: [{ backendId: f.backend.id, ...garage.config }] }, new AbortController().signal)).rejects.toMatchObject({ kind: 'precondition' });
    await operational.restore!(restoreInput, new AbortController().signal);
    await operational.restore!(restoreInput, new AbortController().signal);
    await expect(operational.restore!({ ...restoreInput, requestKey: objectId() }, new AbortController().signal)).rejects.toMatchObject({ kind: 'precondition' });
    const current = (await objectReadRepository(restored.db).object(object.id))!;
    expect(current).toMatchObject({ state: 'ready', sha256, placementRevision: f.backend.placementRevision + 1, referenceCount: 1 });
    expect(current.key).toBe(`restores/${record.id}/${object.id}/${sha256}`);
    expect(await createObjectStoragePlane(restored.db, secretKey).verify(current, new AbortController().signal, current)).toEqual({ size: 100, sha256 });
    expect((await operational.status(record.id)).freeze.phase).toBe('released');
    expect((await objectBackupRepository(restored.db).observe(f.backend.id)).latest?.state).toBe('restored');
    expect(await plane.verify(object, new AbortController().signal, object)).toEqual({ size: 100, sha256 });
    // An altered copy must fail before any restore consumer can claim validity.
    await writeFile(join(bundlePath, 'objects', `${object.id}.blob`), Buffer.alloc(100, 0));
    await expect(bundle.verify()).rejects.toMatchObject({ kind: 'precondition' });
    expect((await restoredTools.status(record.id)).record.state).toBe('restored');
  }, 90_000);
});
