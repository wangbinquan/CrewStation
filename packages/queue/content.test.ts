import { describe, expect, test } from 'bun:test';
import { createTestDatabase, testDatabaseAvailable } from '@crewstation/testkit';
import { sql } from 'drizzle-orm';
import { readQueueContents, removeQueueContents } from './content';
import { queueMigrations } from './jobs';

const available = await testDatabaseAvailable();
describe.skipIf(!available)('queue original content primitives (real PG; no project ownership claim)', () => {
  test('pagination keeps bigint origins and internal payloads; errors stay only in the digest', async () => {
    const db = await createTestDatabase([queueMigrations]);
    try {
      await db.db.execute(sql`INSERT INTO platform_infra.jobs(id,kind,payload,legacy_payload,identity_provenance,dedup_key,last_error)
        VALUES(1,'controlled',${JSON.stringify({ origin: 'one' })}::jsonb,${JSON.stringify({ origin: 'old-one' })}::jsonb,'{}'::jsonb,'one','private error'),
        (9007199254740993,'controlled','{}'::jsonb,NULL,NULL,NULL,NULL)`);
      const first = await readQueueContents(db.db, null, 1), second = await readQueueContents(db.db, first[0]!.id, 1);
      expect(first[0]).toMatchObject({ id: '1', kind: 'controlled', payload: { origin: 'one' }, legacyPayload: { origin: 'old-one' }, dedupKey: 'one' });
      expect(JSON.stringify(first)).not.toContain('private error'); expect(second[0]?.id).toBe('9007199254740993');
      expect(await readQueueContents(db.db, second[0]!.id)).toEqual([]);
      expect(first[0]?.birthDigest).toMatch(/^[a-f0-9]{64}$/); expect(first[0]?.contentDigest).toMatch(/^[a-f0-9]{64}$/);
      await expect(readQueueContents(db.db, '9223372036854775808')).rejects.toThrow();
      await expect(readQueueContents(db.db, null, 0)).rejects.toThrow();
      await expect(removeQueueContents(db.db, [first[0]!, first[0]!])).rejects.toThrow();
    } finally { await db.drop(); }
  });
  test('changed content blocks the entire selected set; unchanged selection removes only its exact origins and replays', async () => {
    const db = await createTestDatabase([queueMigrations]);
    try {
      await db.db.execute(sql`INSERT INTO platform_infra.jobs(id,kind,payload) VALUES(1,'selected','{}'),(2,'retained','{}'),(3,'selected','{}')`);
      const original = await readQueueContents(db.db), selected = original.filter((row) => row.kind === 'selected');
      await db.db.execute(sql`UPDATE platform_infra.jobs SET last_error='new private error' WHERE id=3`);
      expect(await removeQueueContents(db.db, selected)).toEqual({ stable: false, removed: 0 });
      expect((await readQueueContents(db.db)).map((row) => row.id)).toEqual(['1', '2', '3']);
      const current = (await readQueueContents(db.db)).filter((row) => row.kind === 'selected');
      expect(current[1]?.birthDigest).toBe(selected[1]?.birthDigest);
      expect(await removeQueueContents(db.db, current)).toEqual({ stable: true, removed: 2 });
      expect(await removeQueueContents(db.db, current)).toEqual({ stable: true, removed: 0 });
      expect((await readQueueContents(db.db)).map((row) => row.id)).toEqual(['2']);
      expect(await removeQueueContents(db.db, [])).toEqual({ stable: true, removed: 0 });
    } finally { await db.drop(); }
  });
  test('an update committed while deletion waits for the row lock cannot pass the old digest', async () => {
    const db = await createTestDatabase([queueMigrations]), locked = Promise.withResolvers<void>(), release = Promise.withResolvers<void>();
    let writer: Promise<void> | undefined, deleting: ReturnType<typeof removeQueueContents> | undefined;
    try {
      await db.db.execute(sql`INSERT INTO platform_infra.jobs(id,kind,payload) VALUES(1,'controlled','{}')`);
      const original = await readQueueContents(db.db);
      writer = db.db.transaction(async (tx) => {
        await tx.execute(sql`UPDATE platform_infra.jobs SET state='done' WHERE id=1`); locked.resolve(); await release.promise;
      });
      await locked.promise; deleting = removeQueueContents(db.db, original);
      await db.db.execute(sql`DO $wait$ DECLARE deadline timestamptz:=clock_timestamp()+interval '2 seconds'; BEGIN LOOP
        PERFORM pg_stat_clear_snapshot();
        EXIT WHEN EXISTS(SELECT 1 FROM pg_stat_activity WHERE datname=current_database() AND wait_event_type='Lock' AND query LIKE '%WITH requested AS%');
        IF clock_timestamp()>deadline THEN RAISE EXCEPTION 'Actual queue removal never waited for the row lock'; END IF;
        PERFORM pg_sleep(0.01); END LOOP; END $wait$`);
      release.resolve(); await writer;
      expect(await deleting).toEqual({ stable: false, removed: 0 }); expect((await readQueueContents(db.db))[0]?.state).toBe('done');
    } finally { release.resolve(); await Promise.allSettled([writer, deleting]); await db.drop(); }
  });
  test('replacement of a deleted original ID and unknown columns preserve the row', async () => {
    const db = await createTestDatabase([queueMigrations]);
    try {
      await db.db.execute(sql`INSERT INTO platform_infra.jobs(id,kind,payload,created_at) VALUES(1,'controlled','{}','2026-01-01'::timestamptz)`);
      const original = await readQueueContents(db.db);
      await db.db.execute(sql`DELETE FROM platform_infra.jobs WHERE id=1`);
      await db.db.execute(sql`INSERT INTO platform_infra.jobs(id,kind,payload,created_at) VALUES(1,'controlled','{}','2026-02-01'::timestamptz)`);
      expect(await removeQueueContents(db.db, original)).toEqual({ stable: false, removed: 0 });
      await db.db.execute(sql`ALTER TABLE platform_infra.jobs ADD COLUMN future_content text`);
      await expect(readQueueContents(db.db)).rejects.toThrow('unknown');
      await expect(removeQueueContents(db.db, original)).rejects.toThrow('unknown');
      expect((await db.db.execute<{ count: number }>(sql`SELECT count(*)::integer AS count FROM platform_infra.jobs`))[0]?.count).toBe(1);
    } finally { await db.drop(); }
  });
});
