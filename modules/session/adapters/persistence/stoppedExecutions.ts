import { sql } from 'drizzle-orm';
import type { Executor } from '@crewstation/persistence';
import { conflict, gone } from '@crewstation/kernel';

export async function lockBusinessStream(tx: Executor, taskId: string, executionId: string): Promise<void> {
  await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtextextended(${JSON.stringify([taskId, executionId])}, 0))`);
}
export async function assertBusinessStreamOpen(tx: Executor, taskId: string, executionId: string): Promise<void> {
  const rows = await tx.execute<{ expired: boolean }>(sql`SELECT expired FROM session.business_stopped_executions WHERE task_id=${taskId} AND execution_id=${executionId}`);
  if (rows[0]?.expired) throw gone('可靠执行原始日志已过保留期', { code: 'execution_events_expired' });
  if (rows.length) throw conflict('执行环境已停止，不能追加迟到的执行结果', { code: 'execution_runtime_stopped' });
}
/** Separate from complete: termination is proven, while raw output may remain incomplete. */
export async function consumeStoppedStream(tx: Executor, taskId: string, executionId: string): Promise<void> {
  await tx.execute(sql`INSERT INTO session.business_stopped_executions(task_id, execution_id) VALUES (${taskId},${executionId}) ON CONFLICT DO NOTHING`);
}
export async function expireStoppedStreams(tx: Executor): Promise<number> {
  const rows = await tx.execute<{ task_id: string; execution_id: string }>(sql`SELECT task_id, execution_id FROM session.business_stopped_executions
    WHERE stopped_at < clock_timestamp()-interval '7 days' AND expired=false ORDER BY stopped_at LIMIT 20 FOR UPDATE SKIP LOCKED`);
  let count = 0;
  for (const row of rows) {
    await tx.execute(sql`UPDATE session.business_executions SET expired=true WHERE task_id=${row.task_id} AND execution_id=${row.execution_id}`);
    const deleted = await tx.execute(sql`DELETE FROM session.business_execution_events WHERE task_id=${row.task_id} AND execution_id=${row.execution_id} AND sequence IN (
      SELECT sequence FROM session.business_execution_events WHERE task_id=${row.task_id} AND execution_id=${row.execution_id} ORDER BY sequence LIMIT 1000
    ) RETURNING sequence`);
    count += deleted.length;
    if (deleted.length < 1000) await tx.execute(sql`UPDATE session.business_stopped_executions SET expired=true WHERE task_id=${row.task_id} AND execution_id=${row.execution_id}`);
    if (count >= 1000) break;
  }
  return count;
}
