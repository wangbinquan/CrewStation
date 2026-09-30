import type { ResourceRequestDto, ResourceTarget, ResourceValues } from '@crewstation/contracts';

export interface ResourceChange extends ResourceRequestDto {
  requestHash: string;
  approvedRevision: string | null;
  receipt: { revision: string; effect: string; applied: boolean } | null;
  attempt: number;
}

export const IN_FLIGHT = ['pending', 'approved', 'applying', 'needs-review', 'apply-failed'] as const;
export const targetKey = (target: ResourceTarget) => `${target.resourceType}:${target.resourceId}`;
export const sameValues = (a: ResourceValues, b: ResourceValues) => Object.keys(a).length === Object.keys(b).length && Object.entries(a).every(([k, v]) => b[k] === v);

export function changeDto(change: ResourceChange): ResourceRequestDto {
  const { requestHash: _hash, approvedRevision: _revision, receipt: _receipt, attempt: _attempt, ...dto } = change;
  return dto;
}
