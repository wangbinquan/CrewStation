import { and, asc, eq, gt, sql } from 'drizzle-orm';
import type { WorkloadFinalizationFence, WorkloadStopBarrier } from '@crewstation/contracts';
import { conflict, jsonHash, precondition } from '@crewstation/kernel';
import type { Database, Executor } from '@crewstation/persistence';
import type { WorkloadSafety } from '../../../api/workloadSafety';
import { lockStorageTask } from './guards';
import { consumers, storageFences, stopProofs, stopScans } from './tables';

async function requireFence(tx: Executor, taskId: string, finalization: WorkloadFinalizationFence) {
  const fence = (await tx.select().from(storageFences).where(eq(storageFences.taskId, taskId)))[0];
  if (!fence?.finalization || jsonHash(fence.finalization) !== jsonHash(finalization)) throw conflict('任务终结停止屏障身份已变化', { code: 'archive_revision_changed' });
  return fence;
}
/** One page per call, committed cursor; every included consumer is permanently closed before hashing. */
export function workloadStopBarrier(db: Database): Pick<WorkloadSafety, 'sealConsumers' | 'scanStopped'> {
  return {
    sealConsumers: (taskId, finalization) => db.transaction(async (tx) => {
      await lockStorageTask(tx, taskId); await requireFence(tx, taskId, finalization);
      await tx.update(storageFences).set({ sealed: true }).where(eq(storageFences.taskId, taskId));
      await tx.update(consumers).set({ admissionClosed: true }).where(eq(consumers.taskId, taskId));
    }),
    scanStopped: (taskId, finalization, scope) => db.transaction(async (tx): Promise<WorkloadStopBarrier> => {
      await lockStorageTask(tx, taskId);
      const fence = await requireFence(tx, taskId, finalization);
      if (scope === 'all' && !fence.sealed) throw precondition('归档消费者准入尚未封存');
      const key = { taskId, revision: finalization.revision, scope };
      const where = and(eq(stopScans.taskId, taskId), eq(stopScans.revision, finalization.revision), eq(stopScans.scope, scope));
      let scan = (await tx.select().from(stopScans).where(where))[0]?.body ?? { operationId: finalization.operationId, after: null, count: 0, digest: jsonHash({ taskId, ...finalization, scope }), complete: false };
      if (scan.operationId !== finalization.operationId) throw conflict('停止扫描不属于当前终结操作');
      if (scan.complete) return { state: 'complete', count: scan.count, digest: scan.digest, blockedConsumerId: null };
      const page = await tx.select({ row: consumers, proof: stopProofs.record }).from(consumers).leftJoin(stopProofs, eq(stopProofs.consumerId, consumers.id))
        .where(and(eq(consumers.taskId, taskId), scan.after ? gt(consumers.id, scan.after) : undefined, scope === 'business' ? sql`${consumers.consumer}->>'purpose' <> 'archive'` : undefined))
        .orderBy(asc(consumers.id)).limit(100);
      let blocked: string | null = null;
      for (const { row, proof } of page) {
        if (!row.admissionClosed || (row.startPermit && (!proof || proof.podUid !== row.startPermit.podUid || proof.nodeUid !== row.startPermit.nodeUid))) { blocked = row.id; break; }
        scan = { ...scan, after: row.id, count: scan.count + 1, digest: jsonHash({ previous: scan.digest, consumer: row.consumer, startPermit: row.startPermit, proof }) };
      }
      scan = { ...scan, complete: !blocked && page.length < 100 };
      await tx.insert(stopScans).values({ ...key, body: scan }).onConflictDoUpdate({ target: [stopScans.taskId, stopScans.revision, stopScans.scope], set: { body: scan } });
      return { state: blocked ? 'blocked' : scan.complete ? 'complete' : 'pending', count: scan.count, digest: scan.complete ? scan.digest : null, blockedConsumerId: blocked };
    }),
  };
}
