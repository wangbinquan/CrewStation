import { describe, expect, test } from 'bun:test';
import { DomainTopic } from '@crewstation/contracts';
import { createTestDatabase, testDatabaseAvailable } from '@crewstation/testkit';
import { createEventConsumer } from './consumer';
import { eventbusMigrations, publishDomainEvent } from './publish';

const available = await testDatabaseAvailable();
const projectId = 'prj_0123456789abcdef0123456789abcdef' as never;

describe.skipIf(!available)('跨进程事件日志', () => {
  test('发布校验载荷；两个消费者各自有序消费；失败重试后死信', async () => {
    const tdb = await createTestDatabase([eventbusMigrations]);
    try {
      await expect(publishDomainEvent(tdb.db, DomainTopic.projectArchived, { occurredAt: 'not-a-date', projectId } as never)).rejects.toThrow();
      await publishDomainEvent(tdb.db, DomainTopic.projectArchived, { occurredAt: new Date().toISOString(), projectId });
      await publishDomainEvent(tdb.db, DomainTopic.projectArchived, { occurredAt: new Date().toISOString(), projectId });
      const seenA: number[] = [];
      const seenB: number[] = [];
      const a = createEventConsumer({ db: tdb.db, consumer: 'a', maxAttempts: 2 }).on(DomainTopic.projectArchived, async (e) => { seenA.push(e.id); });
      let failures = 0;
      const b = createEventConsumer({ db: tdb.db, consumer: 'b', maxAttempts: 2 }).on(DomainTopic.projectArchived, async (e) => {
        if (e.id === 1 && failures < 5) { failures += 1; throw new Error('flaky'); }
        seenB.push(e.id);
      });
      expect(await a.runOnce()).toBe(2);
      expect(seenA).toEqual([1, 2]);
      expect(await b.runOnce()).toBe(0);
      expect(await b.runOnce()).toBe(2);
      expect(seenB).toEqual([2]);
      const dead = (await tdb.db.execute(`SELECT event_id FROM platform_infra.event_dead_letters WHERE consumer = 'b'`)) as unknown as Array<{ event_id: number }>;
      expect(dead.map((d) => Number(d.event_id))).toEqual([1]);
    } finally {
      await tdb.drop();
    }
  });
});

describe.skipIf(!available)('jsonb 形状', () => {
  test('载荷以对象而不是字符串落库，SQL 可直接取字段', async () => {
    const tdb = await createTestDatabase([eventbusMigrations]);
    try {
      await publishDomainEvent(tdb.db, DomainTopic.projectArchived, { occurredAt: new Date().toISOString(), projectId });
      const rows = (await tdb.db.execute(`SELECT jsonb_typeof(payload) AS t, payload->>'projectId' AS pid FROM platform_infra.domain_events`)) as unknown as Array<{ t: string; pid: string }>;
      expect(rows[0]).toEqual({ t: 'object', pid: projectId });
    } finally {
      await tdb.drop();
    }
  });
});
