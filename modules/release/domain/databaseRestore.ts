import type { Actor, DatabaseRestoreDto, DatabaseRestoreJobFailure, DatabaseRestoreJobReceipt, DatabaseRestoreVerification, Manifest, ReleaseId, RuntimeImageExecutionSnapshot } from '@crewstation/contracts';
import { DatabaseRestoreDtoSchema } from '@crewstation/contracts';
import { conflict, jsonHash, precondition } from '@crewstation/kernel';
import type { Release } from './release';

export interface RestoreJobProof {
  receipt: DatabaseRestoreJobReceipt;
  secretUid: string;
  environmentDigest: string;
  podUid: string | null;
  verification?: DatabaseRestoreVerification;
}
export interface DatabaseRestoreOperation extends Omit<DatabaseRestoreDto, 'actions' | 'blockedReason' | 'confirmationDigest' | 'previousAttempts'> {
  previousAttempts: {jobId: string; purpose: 'database-restore' | 'database-verify'; proof: RestoreJobProof}[];
  requestDigest: string;
  candidateProof: { deploymentUid: string; secretUid: string; environmentDigest: string } | null;
  environmentBox: string | null;
  environmentVersion: number | null;
  sourceBindingRevision: number;
  candidateReleaseId: ReleaseId;
  targetSlot: 'blue' | 'green';
  manifest: Manifest;
  sourceTag: string;
  sourceCommit: string;
  sourceBranch: string;
  executionMaterials: Release['pipeline']['executionMaterials'];
  runtimeImage?: RuntimeImageExecutionSnapshot;
  restoreJobId: string;
  verifyJobId: string;
  restoreProof: RestoreJobProof | null;
  verifyProof: RestoreJobProof | null;
  switchActor: Actor | null;
  maintenanceRevision: number | null;
  maintenanceWasOpen: boolean | null;
  /** The data binding was committed and the execution handoff recorded: only forward completion remains. */
  switchCommitted?: boolean;
}
export const restoreEnded = (op: Pick<DatabaseRestoreOperation, 'stage'>): boolean => op.stage === 'completed' || op.stage === 'abandoned';
/** Abandon ends any restore that has not committed the production binding (RFC-042). */
export const restoreAbandonable = (op: DatabaseRestoreOperation): boolean => !restoreEnded(op) && !op.switchCommitted;
export function restoreConfirmation(op: DatabaseRestoreOperation): string | null {
  if (op.stage !== 'ready-to-switch' || !op.verification || !op.restoreProof || !op.verifyProof || op.error) return null;
  return jsonHash({ id: op.id, revision: op.revision, request: op.requestDigest, target: op.verifyProof.receipt.target,
    restore: op.restoreProof, verify: op.verifyProof, candidate: op.candidateReleaseId, image: op.image });
}
export function restoreDto(op: DatabaseRestoreOperation): DatabaseRestoreDto {
  const confirmationDigest = restoreConfirmation(op);
  const keys = ['id','projectId','serviceId','revision','stage','sourceGenerationId','targetGenerationId','sourceReleaseId','restoreReleaseId','image','backupReference','backupReferenceDigest','createdBy','createdAt','updatedAt','restoreJob','verifyJob','verification','error','observation','abandonedBy','abandonedAt'] as const;
  const fields = Object.fromEntries(keys.filter(key => op[key] !== undefined).map(key => [key,op[key]]));
  const actions = restoreEnded(op) ? [] : op.abandonedAt ? ['abandon'] : [confirmationDigest ? 'switch' : 'retry', ...(restoreAbandonable(op) ? ['abandon'] : [])];
  return DatabaseRestoreDtoSchema.parse({ ...fields, previousAttempts: op.previousAttempts.map(attempt=>({jobId:attempt.jobId,purpose:attempt.purpose,receipt:attempt.proof.receipt})), confirmationDigest, actions, blockedReason: op.error });
}
export function retainJobProof(previous: RestoreJobProof | null, next: RestoreJobProof): RestoreJobProof {
  if (previous && (previous.receipt.uid !== next.receipt.uid || previous.secretUid !== next.secretUid || previous.environmentDigest !== next.environmentDigest
    || previous.receipt.image !== next.receipt.image || jsonHash(previous.receipt.target) !== jsonHash(next.receipt.target)
    || previous.podUid && previous.podUid !== next.podUid)) throw conflict('恢复 Job、Pod、目标或凭据身份已变化');
  if (previous && ['succeeded','failed'].includes(previous.receipt.state)) {
    if (jsonHash(previous) !== jsonHash(next)) throw conflict('恢复 Job 的终态回执不能变化');
    return previous;
  }
  if (next.receipt.state === 'succeeded' && (next.receipt.exitCode !== 0 || !next.podUid)) throw precondition('恢复 Job 尚无实际成功退出证明');
  return next;
}
/** A terminal failed attempt keeps its observed identity; the operation can open a new attempt with the original inputs. */
export function failedJobProof(proof: RestoreJobProof, failure: DatabaseRestoreJobFailure): RestoreJobProof {
  const { verification: _verification, ...rest } = proof;
  return { ...rest, receipt: { ...proof.receipt, state: 'failed', failure } };
}
export const restoreJobName = (id: string, purpose: 'database-restore' | 'database-verify') => `${purpose === 'database-restore' ? 'dbrestore' : 'dbverify'}-${id.replaceAll('-','')}`;
