import type { ServiceId, UserId } from '@crewstation/contracts';
import { precondition } from '@crewstation/kernel';

export type GrantState = 'granted' | 'revoked';

/** 服务 ↔ 操作键的授权。撤销保留记录；操作被移除时授权保留但不再进入放行表。 */
export interface ApiGrant {
  readonly serviceId: ServiceId;
  readonly operationId: string;
  readonly state: GrantState;
  readonly grantedBy: UserId;
  readonly grantedAt: Date;
  readonly revokedAt?: Date;
}

export function grantOperation(serviceId: ServiceId, operationId: string, grantedBy: UserId, now: Date): ApiGrant {
  return { serviceId, operationId, state: 'granted', grantedBy, grantedAt: now };
}

export function revokeGrant(grant: ApiGrant, now: Date): ApiGrant {
  if (grant.state !== 'granted') throw precondition(`授权 ${grant.operationId} 已被撤销`, { operationId: grant.operationId });
  return { ...grant, state: 'revoked', revokedAt: now };
}
