import { eq, sql } from 'drizzle-orm';
import { conflict, forbidden } from '@crewstation/kernel';
import type { Database, Executor, Transaction } from '@crewstation/persistence';
import type { ExecutionAuthorization } from '../../domain/executionControl';
import { assertExecutionFence } from '../../domain/executionControl';
import { executionControls } from './executionTables';

/** 服务级短事务；争锁失败先归还连接。回调只能调用当前事务仓储，不能执行远程派发。 */
export async function executionTransaction<T>(db: Database, serviceId: string, run: (tx: Transaction, now: Date) => Promise<T>): Promise<T> {
  const deadline = Date.now() + 2000;
  do {
    const result = await db.transaction(async (tx) => {
      const rows = await tx.execute<{ acquired: boolean }>(sql`SELECT pg_try_advisory_xact_lock(hashtextextended(${`business.execution:${serviceId}`}, 0)) AS acquired`);
      if (!rows[0]?.acquired) return { acquired: false as const };
      return { acquired: true as const, value: await run(tx, await executionNow(tx)) };
    });
    if (result.acquired) return result.value;
    await Bun.sleep(20);
  } while (Date.now() < deadline);
  throw conflict('执行控制正在变更，请重试', { code: 'execution_control_busy' });
}
export async function executionNow(db: Executor): Promise<Date> {
  const rows = await db.execute<{ now: string }>(sql`SELECT clock_timestamp()::text AS now`);
  return new Date(rows[0]!.now);
}
export async function readExecutionControl(db: Executor, serviceId: string) {
  return (await db.select().from(executionControls).where(eq(executionControls.serviceId, serviceId)))[0]?.body;
}
export async function authorizeExecution(db: Executor, serviceId: string, fenced: boolean, authorization: ExecutionAuthorization | undefined, now: Date): Promise<number | null> {
  const control = await readExecutionControl(db, serviceId);
  // 一旦启用控制记录，不能通过换成 legacy release 绕过它。
  return fenced || control ? assertExecutionFence(control, authorization, now) : null;
}

/** Narrow exception for draining a frozen migration: permits only cancellation and pause/close callers. */
export async function authorizeStoppingExecution(db: Executor, serviceId: string, fenced: boolean, authorization: ExecutionAuthorization | undefined, now: Date): Promise<number | null> {
  if (!authorization?.stopAuthority) return authorizeExecution(db, serviceId, fenced, authorization, now);
  const control = await readExecutionControl(db, serviceId), source = authorization.source, stop = authorization.stopAuthority;
  if (authorization.fence || !control?.migration || control.phase !== 'frozen' || control.epoch !== stop.epoch || control.migration.operationId !== stop.operationId) throw conflict('迁移停止权限已变化', { code: 'stale_generation' });
  if (!source.ready || source.role !== 'prod' || source.releaseId !== control.migration.expectedActiveReleaseId || source.physicalSlot !== control.physicalSlot) throw forbidden('只有原正式发布的可信实例可以排空迁移写者');
  return control.epoch;
}
