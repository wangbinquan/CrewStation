import type { BusinessProjectWork } from '../../ports/deletion/work';
import { finalizationWork } from '../execution/deletion/finalizationWork';
import { newResourceId, PlatformError, precondition } from '@crewstation/kernel';
import type { FinalizationOperations } from '../../ports/storage/finalizations';
import type { FinalizationPreparation } from '../../ports/storage/preparation';
import { finalizationProgress } from './progress';

/** A receipt is fetched from data's single decision point; a helper exit code is never sufficient. */
export function archiveFinalizations(store: FinalizationOperations, archive: FinalizationPreparation['archive'], runtime?: FinalizationPreparation['runtime'], work?: BusinessProjectWork) {
  const commit = finalizationProgress(store, archive);
  return async (id?: string): Promise<number> => {
    const op = await store.claim({ id, owner: newResourceId(), leaseSeconds: 90, phases: ['archiving'] });
    if (!op) return 0;
    return finalizationWork(work, op, 'archive', async () => {
    try {
      const { stopProofDigest, completionProofDigest } = op.evidence;
      if (!stopProofDigest || !completionProofDigest && op.evidence.receipt?.disposition !== 'loss') throw precondition('归档前的执行停止与持久水位证明尚未齐备');
      const { receipt } = await archive.commitArchive(op.id, op.view.revision, { stopProofDigest, completionProofDigest: completionProofDigest ?? null });
      if (!receipt) throw precondition('归档收据尚未持久确认');
      await commit(op, { phase: 'archived', phaseState: 'pending', evidence: { receipt } });
    } catch (error) {
      if (error instanceof PlatformError && error.details?.code === 'archive_helper_pending' && runtime?.archiveExecution) {
        try {
          await runtime.archiveExecution.ensure({ taskId: op.view.taskId, projectId: op.projectId, serviceId: op.serviceId, operationId: op.id, revision: op.view.revision, volumeUid: op.volumeUid });
          await commit(op, { phase: 'archiving', phaseState: 'pending' }); return 1;
        } catch (unavailable) { error = unavailable; }
      }
      const failure = error, known = failure instanceof PlatformError;
      const nextRetryAt = known && typeof failure.details?.nextRetryAt === 'string' ? failure.details.nextRetryAt : undefined;
      await commit(op, { phase: 'archiving', phaseState: known && !nextRetryAt ? 'blocked' : 'retrying', nextRetryAt,
        errorCode: known && typeof failure.details?.code === 'string' ? failure.details.code : 'finalization_archive_pending',
        message: known ? failure.message : '归档依赖暂不可用，原工作卷继续保留并稍后重试' });
    }
    return 1;
    });
  };
}
