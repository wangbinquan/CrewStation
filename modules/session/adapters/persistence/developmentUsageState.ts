import type { DevelopmentUsageKey, DevelopmentUsageReceipt, DevelopmentUsageRegistration, StoredDevelopmentUsage } from '@crewstation/contracts';
import { StoredDevelopmentUsageSchema } from '@crewstation/contracts';
import { conflict, jsonHash, notFound } from '@crewstation/kernel';
import type { Executor } from '@crewstation/persistence';
import { eq } from 'drizzle-orm';
import { developmentUsageStreams as streams } from './developmentUsageTables';

export type DevelopmentUsageRow = typeof streams.$inferSelect;
export const snapshot = (row: DevelopmentUsageRow): StoredDevelopmentUsage => StoredDevelopmentUsageSchema.parse({
  registration: row.registration, receipt: row.receipt, persistedThrough: row.persistedThrough,
  runnerAcknowledgedThrough: row.runnerAcknowledgedThrough, sourceAcknowledgedThrough: row.sourceAcknowledgedThrough, offeredThrough: row.offeredThrough,
  complete: row.complete, drainReason: row.drainReason, loss: row.loss, closure: row.closure,
});
export function assertKey(row: DevelopmentUsageRow, key: DevelopmentUsageKey): void {
  if (jsonHash(row.registration.key) !== jsonHash(key)) throw conflict('开发数字日志键与原受理不同');
}
export function assertHeader(registration: DevelopmentUsageRegistration, receipt: DevelopmentUsageReceipt): void {
  const { runtimeTaskId: _taskId, ...header } = registration;
  const next = { key: receipt.key, podUid: receipt.podUid, identity: receipt.identity, profileId: receipt.profileId, profileRevision: receipt.profileRevision };
  if (jsonHash(header) !== jsonHash(next)) throw conflict('开发数字回执与原环境归属不同');
}
export async function locked(tx: Executor, taskId: string, key: DevelopmentUsageKey): Promise<DevelopmentUsageRow> {
  const [row] = await tx.select().from(streams).where(eq(streams.taskId, taskId)).for('update');
  if (!row) throw notFound('开发数字副本', key.executionId);
  assertKey(row, key); return row;
}
export function latestReceipt(row: DevelopmentUsageRow, incoming: DevelopmentUsageReceipt): DevelopmentUsageReceipt {
  assertHeader(row.registration, incoming);
  if (incoming.acknowledgedSequence > row.persistedThrough) throw conflict('Runner 已确认尚未复制的开发数字');
  const prior = row.receipt;
  if (!prior) return incoming;
  if (prior.phase === 'finished' && incoming.phase === 'finished' && (prior.result !== incoming.result || prior.lastSequence !== incoming.lastSequence)) throw conflict('开发数字回执出现冲突终态');
  if (incoming.phase === 'finished' && incoming.lastSequence < prior.lastSequence) throw conflict('最终水位小于已观测的开发数字末尾');
  if ((prior.phase === 'finished' || prior.interruption) && incoming.lastSequence > prior.lastSequence) throw conflict('开发数字终态或中断后的水位不能增长');
  if (row.complete) return prior;
  let latest = incoming.lastSequence >= prior.lastSequence && (prior.phase !== 'finished' || incoming.phase === 'finished') ? incoming : prior;
  if (prior.phase === 'unknown' && latest.phase !== 'finished') latest = { ...latest, phase: 'unknown' };
  if (prior.interruption) latest = { ...latest, interruption: prior.interruption, finalThrough: null };
  return latest;
}
/** Closing never promotes reported N to copied M. Only an owner lifecycle request allows an interrupted exit. */
export async function updateClosure(tx: Executor, row: DevelopmentUsageRow): Promise<DevelopmentUsageRow> {
  if (!row.drainReason || row.closure) return row;
  const copied = row.persistedThrough, reported = row.receipt?.lastSequence ?? null;
  const interrupted = !!row.loss || (!!row.receipt?.interruption && reported !== null && copied >= reported);
  if (!row.complete && !interrupted) return row;
  const complete = row.complete;
  const [updated] = await tx.update(streams).set({ closure: {
    status: complete ? 'complete' : 'interrupted', persistedThrough: copied, reportedThrough: reported,
    missingAfter: !complete && (reported === null || copied < reported) ? copied : null,
    missingThrough: !complete && reported !== null && copied < reported ? reported : null,
    tailUnknown: !complete, reason: complete ? null : row.loss?.reason ?? row.receipt!.interruption,
    closedAt: new Date().toISOString(),
  } }).where(eq(streams.taskId, row.taskId)).returning();
  return updated!;
}
