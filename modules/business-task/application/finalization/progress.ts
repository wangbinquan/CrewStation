import type { FinalizationOperation, FinalizationProgress } from '../../domain/finalization/operation';
import type { FinalizationOperations } from '../../ports/storage/finalizations';
import type { FinalizationPreparation } from '../../ports/storage/preparation';

export const finalizationLease = (op: FinalizationOperation) => ({ id: op.id, owner: op.lease!.owner, sequence: op.sequence, revision: op.view.revision });
export function finalizationProgress(store: FinalizationOperations, archive: Pick<FinalizationPreparation['archive'], 'observe'>) {
  return async (op: FinalizationOperation, progress: FinalizationProgress) => {
    const saved = await store.progress(finalizationLease(op), progress);
    if (!saved) return;
    const current = await store.get(op.id);
    if (current?.sequence !== op.sequence) return;
    const view = current.view;
    await archive.observe(op.id, view.revision, op.sequence, view.message ? { taskId: view.taskId, operationId: op.id, phase: view.phase,
      code: view.errorCode ?? 'finalization_pending', message: view.message, since: current.observationSince ?? view.updatedAt } : null).catch(() => false);
  };
}
