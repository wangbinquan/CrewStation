import type { BusinessProjectWork } from '../../ports/deletion/work';
import { finalizationWork } from '../execution/deletion/finalizationWork';
import type { BusinessStorageFinalization } from '@crewstation/contracts';
import { conflict, newResourceId, PlatformError, precondition } from '@crewstation/kernel';
import type { FinalizationOperation, FinalizationProgress } from '../../domain/finalization/operation';
import type { FinalizationCompletion } from '../../ports/storage/completion';
import type { FinalizationOperations } from '../../ports/storage/finalizations';
import type { FinalizationPreparation } from '../../ports/storage/preparation';
import type { Runner } from '../../ports/runtime';
import { finalizationLease as lease, finalizationProgress } from './progress';

export function prepareFinalizations(store: FinalizationOperations, completion: FinalizationCompletion, ports: FinalizationPreparation, runner: Runner, work?: BusinessProjectWork) {
  const commit = finalizationProgress(store, ports.archive);
  return async (id?: string): Promise<number> => {
    const claimed = await store.claim({ id, owner: newResourceId(), leaseSeconds: 90, phases: ['requested', 'draining'] });
    if (!claimed) return 0;
    return finalizationWork(work, claimed, 'prepare', async () => {
    let op = claimed;
    try {
      const input: BusinessStorageFinalization = { projectId: op.projectId, serviceId: op.serviceId, taskId: op.view.taskId, operationId: op.id, revision: op.view.revision, volumeUid: op.volumeUid };
      if (op.view.phase === 'requested') {
        await ports.runtime.freezeBusinessStorage(input);
        if (ports.runtime.resolveBusinessStorage) {
          const resolved = await store.bindVolume(lease(op), await ports.runtime.resolveBusinessStorage(input));
          if (!resolved) return 1;
          op = resolved;
        }
        const bound = await ports.archive.bind(op.id);
        if (bound.id !== op.id || bound.revision !== op.view.revision || bound.taskId !== op.view.taskId || bound.taskGeneration !== op.view.taskGeneration || bound.volumeUid !== op.volumeUid) throw conflict('终结归档绑定身份不符');
        await commit(op, { phase: 'draining', phaseState: 'running', evidence: { bindingConfirmed: true } });
      } else await drain(op, input, completion, ports, runner, commit);
    } catch (error) {
      const known = error instanceof PlatformError;
      const code = known && typeof error.details?.code === 'string' ? error.details.code : 'finalization_preparation_pending';
      await commit(op, { phase: op.view.phase, phaseState: known ? 'blocked' : 'retrying', errorCode: code,
        message: known ? error.message : '终结依赖暂不可用，保留原工作卷并稍后重试' });
    }
    return 1;
    });
  };
}
async function drain(op: FinalizationOperation, input: BusinessStorageFinalization, completion: FinalizationCompletion, ports: FinalizationPreparation, runner: Runner, commit: (op: FinalizationOperation, p: FinalizationProgress) => Promise<void>) {
  if (!op.evidence.receipt) {
    const loss = await ports.archive.lossReceipt?.(op.id, op.view.revision);
    if (loss) { await commit(op, { phase: 'draining', phaseState: 'pending', evidence: { receipt: loss } }); return; }
  }
  const lossConfirmed = op.evidence.receipt?.disposition === 'loss';
  let confirmed = op;
  if (!op.completionScan?.complete && !lossConfirmed) {
    const page = await completion.page(op.id);
    if (page.some((candidate) => !['succeeded', 'failed', 'cancelled'].includes(candidate.state))) throw precondition('等待所属应用取消活动执行，或等待执行正常结束', { code: 'finalization_execution_pending' });
    const proofs = await Promise.all(page.map(async (candidate) => {
      if (!candidate.requiresSessionProof) return { subtaskId: candidate.subtaskId, proof: null };
      if (!runner.getExecutionCompletionProof) throw precondition('持久终态证明接口不可用', { code: 'finalization_completion_unavailable' });
      return { subtaskId: candidate.subtaskId, proof: await runner.getExecutionCompletionProof(candidate.executionTaskId, candidate.executionId) };
    }));
    const next = await completion.confirm(lease(op), proofs);
    if (!next) return;
    confirmed = next;
    if (!confirmed.completionScan?.complete) { await commit(op, { phase: 'draining', phaseState: 'pending' }); return; }
  }
  // A disconnected Pod is not stopped until resources has checked its immutable consumer history.
  const stop = await ports.runtime.stopBusinessStorage(input);
  if (stop.state !== 'complete' || !stop.digest) {
    await commit(op, { phase: 'draining', phaseState: stop.state === 'blocked' ? 'blocked' : 'retrying', errorCode: 'finalization_stop_pending', message: '等待原工作卷全部执行消费者的停止证明' }); return;
  }
  // The confirmation writes under this same worker lease; no raw event retention is consulted.
  if (!confirmed.evidence.completionProofDigest && !lossConfirmed) throw precondition('执行持久水位尚未齐备');
  await commit(op, { phase: 'archiving', phaseState: 'pending', evidence: { stopProofDigest: stop.digest, completionProofDigest: confirmed.evidence.completionProofDigest } });
}
