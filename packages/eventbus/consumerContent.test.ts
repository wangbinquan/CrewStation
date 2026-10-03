import { describe, expect, test } from 'bun:test';
import { DomainTopic } from '@crewstation/contracts';
import { createTestDatabase, testDatabaseAvailable } from '@crewstation/testkit';
import { sql } from 'drizzle-orm';
import { createEventConsumer } from './consumer';
import { readEventContents, readOrphanEventDeadLetters, removeEventContents } from './content';
import { eventbusMigrations, publishDomainEvent } from './publish';

const available = await testDatabaseAvailable();
const projectId = '01a0bf5d-8f4b-7e62-8502-0a6dd371d0bc' as never;
describe.skipIf(!available)('actual event consumer content protection', () => {
  test('removal waits for the actual handler and rechecks its committed dead letter', async () => {
    const db = await createTestDatabase([eventbusMigrations]);
    const entered = Promise.withResolvers<void>(), release = Promise.withResolvers<void>();
    let consuming: Promise<number> | undefined, removing: ReturnType<typeof removeEventContents> | undefined;
    try {
      await publishDomainEvent(db.db, DomainTopic.projectArchived, { projectId, occurredAt: new Date().toISOString() });
      const original = (await readEventContents(db.db))[0]!;
      const consumer = createEventConsumer({ db: db.db, consumer: 'actual-paused', maxAttempts: 1 })
        .on(DomainTopic.projectArchived, async () => { entered.resolve(); await release.promise; throw new Error('original handler error'); });
      consuming = consumer.runOnce(); await entered.promise;
      removing = removeEventContents(db.db, [original]);
      // The old consumer did not lock its original row: removal could commit before the late error insert.
      await db.db.execute(sql`DO $wait$ DECLARE deadline timestamptz:=clock_timestamp()+interval '2 seconds'; BEGIN LOOP
        PERFORM pg_stat_clear_snapshot();
        EXIT WHEN EXISTS(SELECT 1 FROM pg_stat_activity WHERE datname=current_database() AND wait_event_type='Lock'
          AND query LIKE '%ORDER BY e.id FOR UPDATE OF e%');
        IF clock_timestamp()>deadline THEN RAISE EXCEPTION 'Removal bypassed the actual original handler'; END IF;
        PERFORM pg_sleep(0.01); END LOOP; END $wait$`);
      release.resolve(); expect(await consuming).toBe(1);
      expect(await removing).toEqual({ stable: false, removed: 0 });
      const current = await readEventContents(db.db);
      expect(current[0]?.deadLetters).toBe(1); expect(await readOrphanEventDeadLetters(db.db)).toHaveLength(0);
      expect(await removeEventContents(db.db, current)).toEqual({ stable: true, removed: 1 });
      expect(await readOrphanEventDeadLetters(db.db)).toHaveLength(0);
      expect((await db.db.execute<{ id: string }>(sql`SELECT last_event_id::text AS id FROM platform_infra.event_cursors
        WHERE consumer='actual-paused'`))[0]?.id).toBe(original.id);
    } finally { release.resolve(); await Promise.allSettled([consuming, removing]); await db.drop(); }
  });
  test('the actual cursor and dead letters preserve consecutive bigint origins beyond the safe Number range', async () => {
    const db = await createTestDatabase([eventbusMigrations]);
    try {
      await db.db.execute(sql`INSERT INTO platform_infra.domain_events(id,topic,payload,occurred_at)
        VALUES(9007199254740993,${DomainTopic.projectArchived},'{}',now()),(9007199254740994,${DomainTopic.projectArchived},'{}',now())`);
      const consumer = createEventConsumer({ db: db.db, consumer: 'exact-origins', maxAttempts: 1 })
        .on(DomainTopic.projectArchived, async () => { throw new Error('original failure'); });
      expect(await consumer.runOnce()).toBe(2); expect(await consumer.runOnce()).toBe(0);
      const errors = await db.db.execute<{ id: string }>(sql`SELECT event_id::text AS id FROM platform_infra.event_dead_letters
        WHERE consumer='exact-origins' ORDER BY event_id`);
      expect(errors.map((row) => row.id)).toEqual(['9007199254740993', '9007199254740994']);
      expect((await db.db.execute<{ id: string }>(sql`SELECT last_event_id::text AS id FROM platform_infra.event_cursors
        WHERE consumer='exact-origins'`))[0]?.id).toBe('9007199254740994');
      expect(await readOrphanEventDeadLetters(db.db)).toHaveLength(0);
    } finally { await db.drop(); }
  });
  test('a replacement original does not inherit retry attempts from the removed row with the same ID', async () => {
    const db = await createTestDatabase([eventbusMigrations]);
    try {
      await publishDomainEvent(db.db, DomainTopic.projectArchived, { projectId, occurredAt: new Date().toISOString() });
      const consumer = createEventConsumer({ db: db.db, consumer: 'replacement', maxAttempts: 2 })
        .on(DomainTopic.projectArchived, async () => { throw new Error('original failure'); });
      expect(await consumer.runOnce()).toBe(0);
      await db.db.execute(sql`DELETE FROM platform_infra.domain_events WHERE id=1`);
      await db.db.execute(sql`INSERT INTO platform_infra.domain_events(id,topic,payload,occurred_at)
        VALUES(1,${DomainTopic.projectArchived},'{"replacement":true}',now())`);
      expect(await consumer.runOnce()).toBe(0);
      expect((await readEventContents(db.db))[0]?.deadLetters).toBe(0);
      expect(await consumer.runOnce()).toBe(1);
      expect((await readEventContents(db.db))[0]?.deadLetters).toBe(1);
      expect(await readOrphanEventDeadLetters(db.db)).toHaveLength(0);
    } finally { await db.drop(); }
  });
});
