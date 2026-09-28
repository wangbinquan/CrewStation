import { and, asc, eq, isNull, lt, or, sql } from 'drizzle-orm';
import type { Database } from '@crewstation/persistence';
import { activeExecutionControl } from '../../domain/executionControl';
import { executionControls as controls, executionOperations as ops } from './executionTables';
import { executionTransaction, readExecutionControl } from './executionTransaction';
import { leaseSeconds, toOperation } from './operationRows';

/** 获得派发票据与冻结共用服务事务；已经在途的原 ID 必须继续对账，不能换 ID。 */
export async function claimExecutionOperation(db: Database, input: { owner: string; leaseSeconds: number; id?: string }) {
  const duration = leaseSeconds(input.leaseSeconds);
  const ready = or(eq(ops.state, 'pending'), and(eq(ops.state, 'running'), or(isNull(ops.leaseUntil), lt(ops.leaseUntil, sql`clock_timestamp()`))));
  const dispatchable = sql`(${ops.state} = 'running' OR ${ops.errorCode} = 'admission_unknown' OR
    (${ops.epoch} IS NULL AND NOT EXISTS (SELECT 1 FROM ${controls} WHERE ${controls.serviceId} = ${ops.serviceId})) OR
    EXISTS (SELECT 1 FROM ${controls} WHERE ${controls.serviceId} = ${ops.serviceId}
      AND ${controls.body}->>'phase' = 'active' AND (${controls.body}->>'epoch')::bigint = ${ops.epoch}
      AND (${controls.body}->'storageSync' IS NULL OR ${controls.body}->'storageSync'->>'version' = ${controls.body}->'storageSync'->>'acknowledgedVersion')
      AND (${controls.body}->>'leaseExpiresAt')::timestamptz > clock_timestamp()
      AND (${controls.body}->'handoff' IS NULL OR ${controls.body}->'handoff'->>'stage' = 'complete'))) `;
  const candidates = await db.select({ id: ops.id, serviceId: ops.serviceId }).from(ops).where(and(ready, dispatchable, input.id ? eq(ops.id, input.id) : undefined)).orderBy(asc(ops.updatedAt), asc(ops.id)).limit(100);
  for (const candidate of candidates) {
    const claimed = await executionTransaction(db, candidate.serviceId, async (tx, now) => {
      const row = (await tx.select().from(ops).where(and(ready, eq(ops.id, candidate.id))).for('update', { skipLocked: true }))[0];
      if (!row) return undefined;
      const recovering = row.state === 'running' || row.errorCode === 'admission_unknown';
      const control = await readExecutionControl(tx, row.serviceId);
      if (!recovering && (control || row.epoch !== null)) {
        if (!control || !activeExecutionControl(control, now) || control.epoch !== row.epoch) return undefined;
      }
      const result = (await tx.update(ops).set({ state: 'running', errorCode: recovering ? 'admission_unknown' : row.errorCode,
        leaseOwner: input.owner, leaseUntil: new Date(now.getTime() + duration * 1000), revision: sql`${ops.revision} + 1`, attempts: sql`${ops.attempts} + 1`, updatedAt: now,
      }).where(eq(ops.id, row.id)).returning())[0]!;
      return toOperation(result);
    });
    if (claimed) return claimed;
  }
  return undefined;
}
