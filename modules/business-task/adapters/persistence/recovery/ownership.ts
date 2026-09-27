import { and, eq } from 'drizzle-orm';
import type { Executor } from '@crewstation/persistence';
import { conflict, newResourceId, notFound } from '@crewstation/kernel';
import type { RecoveryOwnership } from '../../../ports/taskRecovery';
import { assertExecutionFence } from '../../../domain/executionControl';
import { readExecutionControl } from '../executionTransaction';
import { recoveryRequests as requests, recoveryAudit } from './tables';

export async function ownedRecovery(tx: Executor, now: Date, serviceId: string, id: string, ownership: RecoveryOwnership, completedReplay = false) {
  const epoch = assertExecutionFence(await readExecutionControl(tx, serviceId), ownership.authorization, now);
  const row = (await tx.select().from(requests).where(and(eq(requests.serviceId, serviceId), eq(requests.id, id))))[0];
  if (!row) throw notFound('恢复请求', id);
  if (completedReplay && ['succeeded', 'failed'].includes(row.state) && (row.operationId || row.resultSubtaskId || row.resultTaskId)) return row;
  if (!['claimed', 'running'].includes(row.state) || row.claimId !== ownership.claimId || row.claimEpoch !== epoch || row.claimHolder !== ownership.authorization.fence!.instanceId || row.claimPodUid !== ownership.authorization.source.podUid || !row.leaseUntil || row.leaseUntil.getTime() <= now.getTime()) throw conflict('恢复认领已失效', { code: 'recovery_claim_stale' });
  return row;
}
export async function auditRecovery(tx: Executor, now: Date, requestId: string, event: string, actor: string, epoch: number | null) {
  await tx.insert(recoveryAudit).values({ id: newResourceId(), requestId, event, actor, epoch, at: now });
}
