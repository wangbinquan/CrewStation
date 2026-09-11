import type { EgressRequestState, ProjectId, UserId } from '@crewstation/contracts';
import { precondition } from '@crewstation/kernel';

/** 项目成员申请追加出站目标；管理员批准时生成一条项目级条目，拒绝时只记录决定。 */
export interface EgressRequest {
  readonly id: string;
  readonly projectId: ProjectId;
  readonly fqdn: string;
  readonly reason?: string;
  readonly state: EgressRequestState;
  readonly requestedBy: UserId;
  readonly decidedBy?: UserId;
  readonly decision?: string;
  readonly createdAt: Date;
  readonly decidedAt?: Date;
}

export function decideRequest(request: EgressRequest, approve: boolean, decidedBy: UserId, decision: string | undefined, now: Date): EgressRequest {
  if (request.state !== 'pending') throw precondition(`申请 ${request.id} 已是 ${request.state}，不能再次裁定`, { state: request.state });
  return { ...request, state: approve ? 'approved' : 'rejected', decidedBy, decidedAt: now, ...(decision === undefined ? {} : { decision }) };
}
