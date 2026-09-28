import type { BusinessStorageFinalization } from '@crewstation/contracts';
import { newResourceId, PlatformError, precondition } from '@crewstation/kernel';
import type { FinalizationOperations } from '../../ports/storage/finalizations';
import type { FinalizationPreparation } from '../../ports/storage/preparation';
import { finalizationProgress } from './progress';

/** Cross-module replay only advances after each owner has durably acknowledged the same identities. */
export function cleanupFinalizations(store: FinalizationOperations, ports: FinalizationPreparation) {
  const commit = finalizationProgress(store, ports.archive);
  return async (id?: string): Promise<number> => {
    const cleanup = ports.runtime.storageCleanup, archive = ports.archive;
    if (!cleanup || !archive.permitDeletion || !archive.reclaimed) return 0;
    const op = await store.claim({ id, owner: newResourceId(), leaseSeconds: 90, phases: ['archived', 'cleaning'] });
    if (!op) return 0;
    try {
      const input: BusinessStorageFinalization = { taskId: op.view.taskId, projectId: op.projectId, serviceId: op.serviceId, operationId: op.id, revision: op.view.revision, volumeUid: op.volumeUid };
      if (op.view.phase === 'archived') {
        const stopped = await cleanup.prepare(input);
        if (stopped.state !== 'complete' || !stopped.digest || !op.evidence.receipt) throw precondition('等待归档助手和全部卷消费者停止', { code: 'finalization_archive_stop_pending' });
        // The operation ID is a stable idempotency identity even if the reply or business commit is lost.
        await archive.permitDeletion(op.id, op.view.revision, op.id);
        await cleanup.release(input, { id: op.id, taskId: input.taskId, operationId: op.id, revision: input.revision, volumeUid: input.volumeUid, receiptId: op.evidence.receipt.id, allConsumersStoppedDigest: stopped.digest });
        await commit(op, { phase: 'cleaning', phaseState: 'pending', evidence: { deletePermitId: op.id, allConsumersStoppedDigest: stopped.digest } });
      } else {
        const proof = await cleanup.proof(input);
        if (!proof || proof.permitId !== op.evidence.deletePermitId || proof.volumeUid !== op.volumeUid) throw precondition('等待确认卷声明及底层存储回收', { code: 'finalization_storage_reclaim_pending' });
        await archive.reclaimed(op.id, proof.permitId, proof.id);
        await cleanup.complete(input, proof.id);
        await commit(op, { phase: 'completed', phaseState: 'pending', evidence: { reclaim: { proofId: proof.id, volumeDisposition: proof.disposition, storageReclaimed: proof.storageReclaimed } } });
      }
    } catch (error) {
      const known = error instanceof PlatformError;
      await commit(op, { phase: op.view.phase, phaseState: known ? 'blocked' : 'retrying', errorCode: known && typeof error.details?.code === 'string' ? error.details.code : 'finalization_cleanup_pending',
        message: known ? error.message : '回收依赖暂不可用，保留归档收据与回收意图并稍后重试' });
    }
    return 1;
  };
}
