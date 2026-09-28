import { consumeStoppedStream, expireStoppedStreams, lockBusinessStream } from './stoppedExecutions';
import { and, eq, sql } from 'drizzle-orm';
import type { Database } from '@crewstation/persistence';
import { conflict, notFound } from '@crewstation/kernel';
import type { BusinessExecutionStore } from '../../ports/businessExecutions';
import { businessExecutions as streams } from './businessTables';
import { persistCompletionProof } from './completionProofs';

export function businessRetention(db: Database): Pick<BusinessExecutionStore, 'consume' | 'expire'> {
  return {
    consume: (taskId, executionId, through, stopped) => db.transaction(async (tx) => {
      await lockBusinessStream(tx, taskId, executionId);
      if (stopped) { await consumeStoppedStream(tx, taskId, executionId); return; }
      const key = and(eq(streams.taskId, taskId), eq(streams.executionId, executionId));
      const row = (await tx.select().from(streams).where(key).for('update'))[0];
      if (!row) throw notFound('可靠执行', executionId);
      if (!row.complete || through !== row.persistedThrough || through !== row.receipt.lastSequence) throw conflict('只能确认已完整投影的终态执行');
      await persistCompletionProof(tx, row);
      if (row.expired) return;
      if (!row.consumedAt) await tx.update(streams).set({ consumedAt: sql`clock_timestamp()` }).where(key);
    }),
    expire: async () => db.transaction(async (tx) => {
      const rows = await tx.execute<{ task_id: string; execution_id: string }>(sql`SELECT task_id, execution_id FROM session.business_executions
        WHERE consumed_at < clock_timestamp()-interval '7 days' AND complete=true ORDER BY consumed_at LIMIT 20 FOR UPDATE SKIP LOCKED`);
      let count = await expireStoppedStreams(tx);
      for (const row of rows) {
        await tx.execute(sql`UPDATE session.business_executions SET expired=true WHERE task_id=${row.task_id} AND execution_id=${row.execution_id}`);
        const deleted = await tx.execute(sql`DELETE FROM session.business_execution_events WHERE task_id=${row.task_id} AND execution_id=${row.execution_id} AND sequence IN (
          SELECT sequence FROM session.business_execution_events WHERE task_id=${row.task_id} AND execution_id=${row.execution_id} ORDER BY sequence LIMIT 1000
        ) RETURNING sequence`);
        if (deleted.length < 1000) await tx.execute(sql`UPDATE session.business_executions SET consumed_at=NULL WHERE task_id=${row.task_id} AND execution_id=${row.execution_id}`);
        count += deleted.length;
        if (count >= 1000) break;
      }
      return count;
    }),
  };
}
