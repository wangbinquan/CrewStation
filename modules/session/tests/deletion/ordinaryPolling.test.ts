import { describe, expect, test } from 'bun:test';
import { TaskIdSchema } from '@crewstation/contracts';
import { testDatabaseAvailable } from '@crewstation/testkit';
import { sql } from 'drizzle-orm';
import { drizzleBusinessExecutionStore } from '../../adapters/persistence/businessExecutions';
import { drizzleDevelopmentUsageStore } from '../../adapters/persistence/developmentUsage';
import { drizzleDevelopmentUsageSourceStore } from '../../adapters/persistence/developmentUsageSources';
import { drizzleBusinessUsageSourceStore } from '../../adapters/persistence/businessUsageSources';
import { sessionConnectionHistory } from '../../adapters/persistence/deletion/lifetime';
import { developmentRegistration, developmentReceipt, developmentPage, developmentCapture, developmentAt } from '../developmentUsageFixtures';
import { cleanupFixture } from './cleanupFixture';

const available = await testDatabaseAvailable();
describe.skipIf(!available)('ordinary Session pollers (real PG; controlled original ownership)', () => {
  test('sealed pending/outbox and retention rows cannot starve healthy and platform tasks or be selected as proof of empty sealed sources', async () => {
    const f = await cleanupFixture();
    try {
      const other = f.newTask(f.otherProject), platform = f.newTask(null), store = drizzleBusinessExecutionStore(f.database.db), development = drizzleDevelopmentUsageStore(f.database.db);
      const registrations = [f.registration];
      for (const taskId of [other, platform]) {
        await sessionConnectionHistory(f.database.db, f.source).check(taskId);
        await store.register(taskId, { ...f.receipt, executionId: 'other-' + taskId });
        const registration = developmentRegistration(); registration.runtimeTaskId = taskId; registration.key.executionId = taskId; registration.identity.executionId = taskId;
        registrations.push(registration); await development.register(registration);
      }
      for (const registration of registrations) await development.ingest(registration.runtimeTaskId, developmentReceipt(registration, 1), developmentPage(registration, 0, 1));
      for (const taskId of [f.task, other, platform]) {
        const executionId = taskId === f.task ? f.receipt.executionId : 'other-' + taskId;
        await store.ingest(taskId, { ...f.receipt, executionId, phase: 'running', lastSequence: 1 }, [{ sequence: 1, occurredAt: developmentAt,
          frame: { type: 'agent', event: { agentId: 'agent', seq: 1, at: developmentAt, type: 'usage', usageCapture: developmentCapture(1) } } }]);
      }
      const context = { ...f.context, confirmed: await f.owner.inspect(f.target), phase: 'seal' as const }; expect((await f.owner.run(context)).kind).toBe('done');
      expect((await store.pending([f.task, other, platform], 100)).map((row) => row.taskId).sort()).toEqual([other, platform].sort());
      expect((await development.pending([f.task, other, platform], 100)).map((row) => row.registration.runtimeTaskId).sort()).toEqual([other, platform].sort());
      const outbox = drizzleDevelopmentUsageSourceStore(f.database.db);
      const page = (await outbox.next())!; expect([other, platform]).toContain(TaskIdSchema.parse(page.key.executionId));
      await outbox.acknowledge(page.key, page.through);
      const next = (await outbox.next())!; expect(next.key.executionId).not.toBe(page.key.executionId); expect([other, platform]).toContain(TaskIdSchema.parse(next.key.executionId));
      await outbox.acknowledge(next.key, next.through); expect(await outbox.next()).toBeUndefined();
      expect(await f.second.module.api.getDevelopmentUsage(f.task, f.registration.key)).toMatchObject({ persistedThrough: 1, sourceAcknowledgedThrough: 0 });
      const businessOutbox = drizzleBusinessUsageSourceStore(f.database.db);
      for (let i = 0; i < 2; i++) {
        const page = (await businessOutbox.next())!; expect([other, platform]).toContain(page.runtimeTaskId);
        await businessOutbox.acknowledge(page.runtimeTaskId, page.executionId, page.through);
      }
      expect(await businessOutbox.next()).toBeUndefined();
      expect((await f.database.db.execute<{ acknowledged_through: string }>(sql`SELECT acknowledged_through FROM session.business_usage_sources WHERE task_id=${f.task}`))[0]!.acknowledged_through).toBe('0');
      // Retention must skip the sealed task itself rather than poisoning the entire batch.
      await f.database.db.execute('ALTER TABLE session.business_executions DISABLE TRIGGER session_content_guard');
      await f.database.db.execute("UPDATE session.business_executions SET complete=true,consumed_at=clock_timestamp()-interval '8 days'");
      await f.database.db.execute('ALTER TABLE session.business_executions ENABLE TRIGGER session_content_guard');
      expect(await store.expire()).toBe(2);
      expect(await store.get(f.task, f.receipt.executionId)).toMatchObject({ complete: true });
      expect((await f.database.db.execute<{ consumed_at: unknown }>(sql`SELECT consumed_at FROM session.business_executions WHERE task_id=${f.task}`))[0]!.consumed_at).not.toBeNull();
      expect((await f.database.db.execute<{ consumed_at: unknown }>(sql`SELECT consumed_at FROM session.business_executions WHERE task_id=${other}`))[0]!.consumed_at).toBeNull();
    } finally { await f.drop(); }
  });
});
