import type { ApiRequestState, ProjectId, ServiceId, UserId } from '@crewstation/contracts';
import { precondition } from '@crewstation/kernel';

/** 业务对定向开放操作的申请：pending → approved｜rejected，一次裁决后不可更改，再申请要新建。 */
export interface ApiRequest {
  readonly id: string;
  readonly serviceId: ServiceId;
  readonly projectId: ProjectId;
  readonly operationKey: string;
  readonly state: ApiRequestState;
  readonly reason?: string;
  readonly requestedBy: UserId;
  readonly decidedBy?: UserId;
  readonly decision?: string;
  readonly createdAt: Date;
  readonly decidedAt?: Date;
}

export function decideRequest(request: ApiRequest, approve: boolean, decidedBy: UserId, decision: string | undefined, now: Date): ApiRequest {
  if (request.state !== 'pending') throw precondition(`申请 ${request.id} 已是 ${request.state}`, { state: request.state });
  return {
    ...request,
    state: approve ? 'approved' : 'rejected',
    decidedBy,
    decidedAt: now,
    ...(decision === undefined ? {} : { decision }),
  };
}
