import type { ArchiveReceiptDto, BusinessFinalizationDto, FinalizationArchive, FinalizationPhase, ProjectId, ServiceId, UserId } from '@crewstation/contracts';
import { conflict, jsonHash, precondition } from '@crewstation/kernel';

export interface FinalizationEvidence {
  readonly volumeIdentityConfirmed?: true;
  readonly bindingConfirmed?: boolean;
  readonly stopProofDigest?: string;
  readonly completionProofDigest?: string;
  readonly receipt?: ArchiveReceiptDto;
  readonly allConsumersStoppedDigest?: string;
  readonly deletePermitId?: string;
  readonly reclaim?: { readonly proofId: string; readonly volumeDisposition: 'deleted' | 'never-provisioned' | 'lost'; readonly storageReclaimed: boolean | null };
}
/** Contract revision and worker lease sequence are independent; service lease changes never erase accepted work. */
export interface FinalizationOperation {
  readonly id: string; readonly projectId: ProjectId; readonly serviceId: ServiceId;
  readonly requestKey: string; readonly requestDigest: string; readonly expectedGeneration: number;
  readonly spaceId: string; readonly volumeUid: string | null; readonly archive: FinalizationArchive;
  readonly acceptedBy: { readonly type: 'service'; readonly podUid: string; readonly epoch: number | null } | { readonly type: 'user'; readonly userId: UserId; readonly reason: string };
  readonly view: BusinessFinalizationDto; readonly evidence: FinalizationEvidence;
  readonly observationSince?: string | null;
  readonly revisionRequestId?: string;
  readonly completionScan?: { readonly after: string | null; readonly digest: string; readonly count: number; readonly complete: boolean };
  readonly sequence: number; readonly lease: { readonly owner: string; readonly until: string } | null;
}
export interface FinalizationLease { readonly id: string; readonly owner: string; readonly sequence: number; readonly revision: number }
export interface FinalizationProgress {
  readonly phase: FinalizationPhase;
  readonly phaseState: BusinessFinalizationDto['phaseState'];
  readonly errorCode?: string; readonly message?: string; readonly nextRetryAt?: string;
  readonly evidence?: FinalizationEvidence;
}

const phases: readonly FinalizationPhase[] = ['requested', 'draining', 'archiving', 'archived', 'cleaning', 'completed'];
/** Only typed, persistent evidence from the owning modules can satisfy these barriers. */
export function advanceFinalization(operation: FinalizationOperation, progress: FinalizationProgress, now: Date): FinalizationOperation {
  const current = phases.indexOf(operation.view.phase), next = phases.indexOf(progress.phase);
  if (next < current || next > current + 1) throw conflict('终结阶段只能顺序推进', { code: 'finalization_phase_conflict' });
  const evidence = mergeEvidence(operation.evidence, progress.evidence ?? {});
  assertPhaseEvidence(operation, progress.phase, evidence);
  const receipt = evidence.receipt ?? null, reclaim = evidence.reclaim;
  const observationSince = ['blocked', 'retrying'].includes(progress.phaseState) ? (operation.view.phase === progress.phase && operation.view.errorCode === progress.errorCode ? operation.observationSince : null) ?? now.toISOString() : null;
  return { ...operation, evidence, observationSince, lease: null, view: { ...operation.view, phase: progress.phase, phaseState: progress.phaseState,
    errorCode: progress.errorCode ?? null, message: progress.message ?? null, retryable: progress.phaseState === 'retrying', nextRetryAt: progress.nextRetryAt ?? null,
    receipt, computeStopped: !!evidence.stopProofDigest, artifactsReady: !!receipt && ['archived', 'empty'].includes(receipt.disposition),
    volumeDisposition: reclaim?.volumeDisposition ?? 'pending', storageReclaimed: reclaim?.storageReclaimed ?? null, updatedAt: now.toISOString() } };
}
function mergeEvidence(prior: FinalizationEvidence, patch: FinalizationEvidence): FinalizationEvidence {
  for (const key of Object.keys(patch) as Array<keyof FinalizationEvidence>) {
    if (prior[key] !== undefined && jsonHash(prior[key]) !== jsonHash(patch[key])) throw conflict('已持久确认的终结证明不可替换');
  }
  return { ...prior, ...patch };
}
function assertPhaseEvidence(op: FinalizationOperation, phase: FinalizationPhase, e: FinalizationEvidence): void {
  const step = phases.indexOf(phase);
  if (step >= 1 && !e.bindingConfirmed) throw precondition('归档绑定尚未持久确认');
  if (step >= 2 && (!e.stopProofDigest || !e.completionProofDigest && e.receipt?.disposition !== 'loss')) throw precondition('执行停止与持久结果证明尚未齐备');
  if (e.receipt && (e.receipt.taskId !== op.view.taskId || e.receipt.finalizationId !== op.id || e.receipt.finalizationRevision !== op.view.revision || e.receipt.taskGeneration !== op.view.taskGeneration || e.receipt.volumeUid !== op.volumeUid)) throw conflict('归档收据与当前终结身份不符');
  if (step >= 3 && !e.receipt) throw precondition('归档收据尚未持久确认');
  if (step >= 4 && (!e.deletePermitId || !e.allConsumersStoppedDigest)) throw precondition('清理许可或全部消费者停止证明尚未齐备');
  if (step >= 5 && (!e.reclaim || (e.reclaim.volumeDisposition !== 'never-provisioned' && e.reclaim.storageReclaimed !== true))) throw precondition('存储物理回收尚未确认');
  if (e.reclaim?.volumeDisposition === 'never-provisioned' && (op.volumeUid !== null || !['never-provisioned', 'loss'].includes(e.receipt?.disposition ?? '') || e.reclaim.storageReclaimed !== null)) throw conflict('从未供给墓碑与卷或归档事实不符');
}
