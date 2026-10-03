import type { BusinessProjectWork } from '../../ports/deletion/work';
import { finalizationWork } from '../execution/deletion/finalizationWork';
import type { BusinessStorageFinalization } from '@crewstation/contracts';
import { conflict, isPlatformError, newResourceId, precondition } from '@crewstation/kernel';
import type { BusinessExecutionApi } from '../../api/executionApi';
import type { FinalizationOperations } from '../../ports/storage/finalizations';
import type { FinalizationPreparation } from '../../ports/storage/preparation';
import type { BusinessExecutionDeps } from '../execution/dependencies';
import { executionSource } from '../execution/source';
import { finalizationLease } from './progress';

/** The accepted change is an outbox. Only data can decide whether it beats the old receipt. */
export function finalizationRevisions(store: FinalizationOperations, ports: FinalizationPreparation, work?: BusinessProjectWork) {
  return async (id?: string): Promise<number> => {
    const revise = ports.archive.revise, stop = ports.runtime.archiveExecution?.stop;
    if (!revise || !stop) return 0;
    const op = await store.claim({ id, owner: newResourceId(), leaseSeconds: 90, revising: true });
    if (!op) return 0;
    return finalizationWork(work, op, 'revise', async () => {
    const lease = finalizationLease(op);
    try {
      const change = op.revisionRequestId ? await store.revision(op.revisionRequestId) : undefined;
      if (!change || change.state !== 'pending') throw precondition('清单修订意图缺失');
      const result = await revise(change.id);
      if (!result.applied) { await store.settleRevision(lease, false, 'archive_receipt_already_committed'); return 1; }
      if (result.binding.revision !== op.view.revision + 1 || result.binding.receipt) throw conflict('清单修订回执身份不符');
      const input: BusinessStorageFinalization = { taskId: op.view.taskId, projectId: op.projectId, serviceId: op.serviceId, operationId: op.id, revision: op.view.revision, volumeUid: op.volumeUid };
      if (!await stop(input)) throw precondition('新清单已持久确认，等待旧归档助手停止', { code: 'archive_revision_stop_pending' });
      await store.settleRevision(lease, true);
    } catch (error) {
      const code = isPlatformError(error) && typeof error.details.code === 'string' ? error.details.code : 'archive_revision_pending';
      // These are determinate data-CAS rejections. Transient dependencies retain the accepted outbox.
      if (isPlatformError(error) && (['validation', 'not_found'].includes(error.kind) || ['archive_discard_confirmation_required', 'storage_revision_conflict', 'idempotency_conflict', 'storage_request_conflict', 'archive_manifest_unavailable'].includes(code))) await store.settleRevision(lease, false, code);
      else await store.progress(lease, { phase: op.view.phase, phaseState: 'revising', errorCode: code, message: isPlatformError(error) ? error.message : '清单修订确认暂不可用，保留原卷并继续对账', nextRetryAt: new Date(Date.now() + 5000).toISOString() });
    }
    return 1;
    });
  };
}

export function archiveRevisionIntake(deps: BusinessExecutionDeps, store: FinalizationOperations, ports?: FinalizationPreparation): Pick<BusinessExecutionApi, 'reviseArchive'> {
  const source = executionSource(deps), progress = ports ? finalizationRevisions(store, ports, deps.projectWork) : undefined;
  return {
    reviseArchive: async (caller, taskId, input) => {
      const context = await source(caller);
      if (!ports?.archive.revise || !ports.runtime.archiveExecution?.stop || !progress) throw precondition('清单修订能力尚未就绪', { code: 'archive_revision_unavailable' });
      const change = await store.revise(context.serviceId, taskId, input, { source: context.authority, fence: input.fence });
      if (change.state === 'pending') await progress(change.finalizationId);
      const current = (await store.revision(change.id))!;
      if (current.state === 'rejected') throw conflict('清单修订未生效，请查询当前终结操作', { code: current.errorCode });
      return (await store.get(change.finalizationId))!.view;
    },
  };
}
