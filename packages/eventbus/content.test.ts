import { describe, expect, test } from 'bun:test';
import { createTestDatabase, testDatabaseAvailable } from '@crewstation/testkit';
import { sql } from 'drizzle-orm';
import { readEventContents, readOrphanEventDeadLetters, removeEventContents, writeEventDeadLetter } from './content';
import { eventbusMigrations } from './publish';

const available = await testDatabaseAvailable();
describe.skipIf(!available)('event content primitives (real PG)', () => {
  test('whole origins paginate exact bigint IDs; private trace and dead-letter bodies are only hashed', async () => {
    const db = await createTestDatabase([eventbusMigrations]);
    try {
      await db.db.execute(sql`INSERT INTO platform_infra.domain_events(id,topic,payload,trace_id,occurred_at,legacy_payload)
        VALUES(1,'controlled','{"projectId":"current"}','private trace',now(),'{"projectId":"old"}'),
          (9007199254740993,'controlled','{}',NULL,now(),NULL)`);
      await db.db.execute(sql`INSERT INTO platform_infra.event_dead_letters(consumer,event_id,error) VALUES('a',1,'private error')`);
      const first = await readEventContents(db.db,null,1),second = await readEventContents(db.db,first[0]!.id,1);
      expect(first[0]).toMatchObject({ id:'1',payload:{projectId:'current'},legacyPayload:{projectId:'old'},deadLetters:1 });
      expect(JSON.stringify(first)).not.toContain('private trace'); expect(JSON.stringify(first)).not.toContain('private error');
      expect(second[0]?.id).toBe('9007199254740993'); expect(await readEventContents(db.db,second[0]!.id)).toEqual([]);
      await expect(readEventContents(db.db,'9223372036854775808')).rejects.toThrow();
      await expect(readEventContents(db.db,null,201)).rejects.toThrow();
      await expect(removeEventContents(db.db,[first[0]!,first[0]!])).rejects.toThrow();
    } finally { await db.drop(); }
  });
  test('changed errors preserve all selected events; exact cleanup removes their errors and preserves global cursors and other events', async () => {
    const db = await createTestDatabase([eventbusMigrations]);
    try {
      await db.db.execute(sql`INSERT INTO platform_infra.domain_events(id,topic,payload,occurred_at) VALUES(1,'selected','{}',now()),(2,'retained','{}',now()),(3,'selected','{}',now())`);
      await db.db.execute(sql`INSERT INTO platform_infra.event_dead_letters(consumer,event_id,error) VALUES('a',1,'one'),('a',3,'three')`);
      await db.db.execute(sql`INSERT INTO platform_infra.event_cursors(consumer,last_event_id) VALUES('a',3)`);
      const originals = (await readEventContents(db.db)).filter((row) => row.topic==='selected');
      await db.db.execute(sql`UPDATE platform_infra.event_dead_letters SET error='changed' WHERE event_id=3`);
      expect(await removeEventContents(db.db,originals)).toEqual({stable:false,removed:0});
      expect((await readEventContents(db.db)).map((row) => row.id)).toEqual(['1','2','3']);
      const current = (await readEventContents(db.db)).filter((row) => row.topic==='selected');
      expect(current[1]?.birthDigest).toBe(originals[1]?.birthDigest);
      expect(await removeEventContents(db.db,current)).toEqual({stable:true,removed:2});
      expect(await removeEventContents(db.db,current)).toEqual({stable:true,removed:0});
      expect((await readEventContents(db.db)).map((row) => row.id)).toEqual(['2']);
      expect((await db.db.execute<{n:number}>(sql`SELECT count(*)::integer AS n FROM platform_infra.event_dead_letters`))[0]?.n).toBe(0);
      expect((await db.db.execute<{id:string}>(sql`SELECT last_event_id::text AS id FROM platform_infra.event_cursors WHERE consumer='a'`))[0]?.id).toBe('3');
      expect(await removeEventContents(db.db,[])).toEqual({stable:true,removed:0});
    } finally { await db.drop(); }
  });
  test('a new error committed while deletion waits is seen after the original event lock', async () => {
    const db = await createTestDatabase([eventbusMigrations]),locked = Promise.withResolvers<void>(),release = Promise.withResolvers<void>();
    let writer: Promise<void> | undefined,deleting: ReturnType<typeof removeEventContents> | undefined;
    try {
      await db.db.execute(sql`INSERT INTO platform_infra.domain_events(id,topic,payload,occurred_at) VALUES(1,'controlled','{}',now())`);
      const original = (await readEventContents(db.db))[0]!;
      writer = db.db.transaction(async (tx) => {
        expect(await writeEventDeadLetter(tx,original,'a','new error')).toBe(true); locked.resolve(); await release.promise;
      });
      await locked.promise; deleting = removeEventContents(db.db,[original]);
      await db.db.execute(sql`DO $wait$ DECLARE deadline timestamptz:=clock_timestamp()+interval '2 seconds'; BEGIN LOOP
        PERFORM pg_stat_clear_snapshot();
        EXIT WHEN EXISTS(SELECT 1 FROM pg_stat_activity WHERE datname=current_database() AND wait_event_type='Lock' AND query LIKE '%ORDER BY e.id FOR UPDATE OF e%');
        IF clock_timestamp()>deadline THEN RAISE EXCEPTION 'Actual event removal did not wait for the original'; END IF;
        PERFORM pg_sleep(0.01); END LOOP; END $wait$`);
      release.resolve(); await writer;
      expect(await deleting).toEqual({stable:false,removed:0}); expect((await readEventContents(db.db))[0]?.deadLetters).toBe(1);
    } finally { release.resolve(); await Promise.allSettled([writer,deleting]); await db.drop(); }
  });
  test('a late original consumer cannot recreate an error after deletion or attach it to a replacement ID', async () => {
    const db = await createTestDatabase([eventbusMigrations]);
    try {
      await db.db.execute(sql`INSERT INTO platform_infra.domain_events(id,topic,payload,occurred_at) VALUES(1,'controlled','{}',now())`);
      const original = (await readEventContents(db.db))[0]!;
      expect(await removeEventContents(db.db,[original])).toEqual({stable:true,removed:1});
      expect(await db.db.transaction((tx) => writeEventDeadLetter(tx,original,'a','late'))).toBe(false);
      await db.db.execute(sql`INSERT INTO platform_infra.domain_events(id,topic,payload,occurred_at) VALUES(1,'replacement','{}',now())`);
      expect(await db.db.transaction((tx) => writeEventDeadLetter(tx,original,'a','late'))).toBe(false);
      expect(await removeEventContents(db.db,[original])).toEqual({stable:false,removed:0});
      expect((await readEventContents(db.db))[0]?.deadLetters).toBe(0);
    } finally { await db.drop(); }
  });
  test('a late error waiting for the deletion lock rechecks the missing original after commit', async () => {
    const db = await createTestDatabase([eventbusMigrations]),locked = Promise.withResolvers<void>(),release = Promise.withResolvers<void>();
    let deleting: Promise<void> | undefined,writer: Promise<boolean> | undefined;
    try {
      await db.db.execute(sql`INSERT INTO platform_infra.domain_events(id,topic,payload,occurred_at) VALUES(1,'controlled','{}',now())`);
      const original = (await readEventContents(db.db))[0]!;
      deleting = db.db.transaction(async (tx) => {
        await tx.execute(sql`DELETE FROM platform_infra.domain_events WHERE id=1`); locked.resolve(); await release.promise;
      });
      await locked.promise; writer = db.db.transaction((tx) => writeEventDeadLetter(tx,original,'late','never recreate'));
      await db.db.execute(sql`DO $wait$ DECLARE deadline timestamptz:=clock_timestamp()+interval '2 seconds'; BEGIN LOOP
        PERFORM pg_stat_clear_snapshot();
        EXIT WHEN EXISTS(SELECT 1 FROM pg_stat_activity WHERE datname=current_database() AND wait_event_type='Lock' AND query LIKE '%WITH original AS MATERIALIZED%');
        IF clock_timestamp()>deadline THEN RAISE EXCEPTION 'Actual late error did not wait for deletion'; END IF;
        PERFORM pg_sleep(0.01); END LOOP; END $wait$`);
      release.resolve(); await deleting;
      expect(await writer).toBe(false);
      expect((await db.db.execute<{n:number}>(sql`SELECT count(*)::integer AS n FROM platform_infra.event_dead_letters`))[0]?.n).toBe(0);
    } finally { release.resolve(); await Promise.allSettled([deleting,writer]); await db.drop(); }
  });
  test('an orphaned error or unknown content column blocks replay without losing any data', async () => {
    const db = await createTestDatabase([eventbusMigrations]);
    try {
      await db.db.execute(sql`INSERT INTO platform_infra.domain_events(id,topic,payload,occurred_at) VALUES(1,'controlled','{}',now())`);
      const original = (await readEventContents(db.db))[0]!;
      await db.db.execute(sql`DELETE FROM platform_infra.domain_events WHERE id=1`);
      await db.db.execute(sql`INSERT INTO platform_infra.event_dead_letters(consumer,event_id,error) VALUES('A',1,'kept'),('a',1,'also kept')`);
      expect(await removeEventContents(db.db,[original])).toEqual({stable:false,removed:0});
      const first = await readOrphanEventDeadLetters(db.db,null,1),next = await readOrphanEventDeadLetters(db.db,{eventId:first[0]!.event_id,consumer:first[0]!.consumer},1);
      expect(first[0]).toMatchObject({event_id:'1',consumer:'A'}); expect(next[0]?.consumer).toBe('a');
      expect(first[0]?.digest).toMatch(/^[a-f0-9]{64}$/); expect(JSON.stringify(first)).not.toContain('kept');
      await expect(readOrphanEventDeadLetters(db.db,{eventId:'no-id',consumer:'a'})).rejects.toThrow();
      await db.db.execute(sql`ALTER TABLE platform_infra.event_dead_letters ADD COLUMN future_content text`);
      await expect(readEventContents(db.db)).rejects.toThrow('unknown');
      await expect(removeEventContents(db.db,[original])).rejects.toThrow('unknown');
      expect((await db.db.execute<{n:number}>(sql`SELECT count(*)::integer AS n FROM platform_infra.event_dead_letters`))[0]?.n).toBe(2);
    } finally { await db.drop(); }
  });
});
