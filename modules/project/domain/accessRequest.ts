import type { AppAccessRequestState, ProjectId, UserId } from '@crewstation/contracts';
import { precondition } from '@crewstation/kernel';

/** 一条应用使用申请：pending → approved｜rejected，一次裁决后不可更改；被拒后再申请是新的一条。 */
export interface AccessRequest {
  readonly id: string;
  readonly projectId: ProjectId;
  readonly requestedBy: UserId;
  readonly state: AppAccessRequestState;
  readonly reason?: string;
  readonly decidedBy?: UserId;
  readonly decision?: string;
  readonly createdAt: Date;
  readonly decidedAt?: Date;
}

export function decideAccessRequest(request: AccessRequest, approve: boolean, decidedBy: UserId, decision: string | undefined, now: Date): AccessRequest {
  if (request.state !== 'pending') throw precondition('这条申请已经处理过了', { state: request.state });
  return { ...request, state: approve ? 'approved' : 'rejected', decidedBy, decidedAt: now, ...(decision ? { decision } : {}) };
}
