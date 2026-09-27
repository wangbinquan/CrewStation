import type { Fence, Platform } from './client';
import type { Store } from './store';

export interface RecoveryRequest {
  id: string; state: string; operationId?: string; resultSubtaskId?: string; resultTaskId?: string;
  target: { action: string; taskId: string; expectedGeneration: number; materialDigest: string; volumeUid?: string; subtaskId?: string; expectedAttempt?: number; resumeSessionId?: string };
}
export interface RecoveryClaim { request: RecoveryRequest; claimId: string; expiresAt: string }

/** One durable intent per tick. A lost reply reuses the original key, never a new task/attempt. */
export async function consumeRecovery(platform: Platform, store: Store, fence: Fence): Promise<void> {
  const claim = await platform.call<RecoveryClaim | null>('/v3/business-execution/recovery/claim', { fence });
  if (!claim) return;
  const { request } = claim;
  await store.admitRecovery(request, fence);
  // A receipt is admission, not completion. Replay the original key with the current
  // fence so an undispatched old-epoch operation or quota rejection can be adopted.
  // The platform returns the existing operation/attempt without executing it twice.
  const root = `/v3/business-tasks/${encodeURIComponent(request.target.taskId)}`;
  const common = { requestKey: `recovery:${request.id}`, fence, recovery: { recoveryRequestId: request.id, claimId: claim.claimId } };
  let response: unknown;
  if (['resume-task', 'rebuild-workspace'].includes(request.target.action)) response = await platform.call(`${root}/${request.target.action === 'resume-task' ? 'resume' : 'rebuild'}`, { ...common, expectedGeneration: request.target.expectedGeneration });
  else if (request.target.action === 'restart-task') response = await platform.call(`${root}/restart`, { ...common, expectedGeneration: request.target.expectedGeneration });
  else if (['retry-subtask', 'resume-subtask'].includes(request.target.action) && request.target.subtaskId && request.target.expectedAttempt && (request.target.action !== 'resume-subtask' || request.target.resumeSessionId)) {
    response = await platform.call(`${root}/subtasks/${encodeURIComponent(request.target.subtaskId)}/retry`, { ...common, expectedAttempt: request.target.expectedAttempt,
      ...(request.target.action === 'resume-subtask' ? { resumePolicy: 'resume', resumeSessionId: request.target.resumeSessionId } : { resumePolicy: 'fresh' }) });
  } else response = await platform.call(`/v3/business-execution/recovery/${encodeURIComponent(request.id)}/reject`, { fence, claimId: claim.claimId, reason: '此示例版本不支持该恢复动作' });
  await store.recordRecovery(request.id, response, fence);
}
