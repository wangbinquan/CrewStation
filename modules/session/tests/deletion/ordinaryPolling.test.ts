import { describe, expect, test } from 'bun:test';
import { testDatabaseAvailable } from '@crewstation/testkit';
import { sql } from 'drizzle-orm';
import { drizzleBusinessExecutionStore } from '../../adapters/persistence/businessExecutions';
import { sessionConnectionHistory } from '../../adapters/persistence/deletion/lifetime';
import { cleanupFixture } from './cleanupFixture';

const available = await testDatabaseAvailable();
describe.skipIf(!available)('ordinary Session pollers (real PG; controlled original ownership)', () => {
  test('sealed pending and retention rows cannot starve healthy and platform tasks', async () => {
    const f = await cleanupFixture();
    try {
      const other = f.newTask(f.otherProject), platform = f.newTask(null), store = drizzleBusinessExecutionStore(f.database.db);
      for (const taskId of [other, platform]) {
        await sessionConnectionHistory(f.database.db, f.source).check(taskId);
        await store.register(taskId, { ...f.receipt, executionId: 'other-' + taskId });
      }
      const at = new Date().toISOString();
      for (const taskId of [f.task, other, platform]) {
        const executionId = taskId === f.task ? f.receipt.executionId : 'other-' + taskId;
        await store.ingest(taskId, { ...f.receipt, executionId, phase: 'running', lastSequence: 1 }, [{ sequence: 1, occurredAt: at,
          frame: { type: 'output', stream: 'stdout', text: 'line' } }]);
      }
      const context = { ...f.context, confirmed: await f.owner.inspect(f.target), phase: 'seal' as const }; expect((await f.owner.run(context)).kind).toBe('done');
      expect((await store.pending([f.task, other, platform], 100)).map((row) => row.taskId).sort()).toEqual([other, platform].sort());
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
