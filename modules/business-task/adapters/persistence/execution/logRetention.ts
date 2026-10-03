import { and, asc, eq, lt, sql } from 'drizzle-orm';
import type { Database } from '@crewstation/persistence';
import { executionTransaction } from '../executionTransaction';
import { executionLogs as logs } from './projectionTables';
import { businessAdmissionOpen } from '../deletion/admission';

/** Only confirmed closed parents expire. Each tick deletes at most 1000 events and preserves the cursor tombstone. */
export async function expireExecutionLog(db: Database): Promise<number> {
  const candidates = await db.select().from(logs).where(and(businessAdmissionOpen(logs.serviceId), lt(logs.closedAt, sql`clock_timestamp()-interval '7 days'`))).orderBy(asc(logs.closedAt)).limit(20);
  for (const candidate of candidates) {
    const count = await executionTransaction(db, candidate.serviceId, async (tx) => {
      const current = (await tx.select().from(logs).where(and(eq(logs.taskId, candidate.taskId), lt(logs.closedAt, sql`clock_timestamp()-interval '7 days'`))).for('update'))[0];
      if (!current) return 0;
      if (!current.expired) await tx.update(logs).set({ expired: true, generation: current.generation + 1 }).where(eq(logs.taskId, current.taskId));
      const removed = await tx.execute(sql`DELETE FROM business_task.execution_events WHERE task_id=${current.taskId} AND sequence IN (
        SELECT sequence FROM business_task.execution_events WHERE task_id=${current.taskId} ORDER BY sequence LIMIT 1000
      ) RETURNING sequence`);
      if (removed.length < 1000) await tx.update(logs).set({ closedAt: null }).where(eq(logs.taskId, current.taskId));
      return removed.length || (!current.expired ? 1 : 0);
    });
    if (count) return count;
  }
  return 0;
}
