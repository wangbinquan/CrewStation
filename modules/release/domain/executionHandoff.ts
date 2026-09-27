import type { ReleaseId, ProjectId, ServiceId, TrafficSwitchDto, UserId } from '@crewstation/contracts';

export type HandoffStage = 'freezing' | 'preparing' | 'routing' | 'activating' | 'complete';
/** Each external side effect is repeatable under this stable operation identity. Failure retains the frozen phase. */
export interface ExecutionHandoffOperation {
  id: string; requestKey: string; serviceId: ServiceId; projectId: ProjectId;
  expectedActiveReleaseId: ReleaseId | null; targetReleaseId: ReleaseId; targetSlot: 'blue' | 'green';
  stage: HandoffStage; epoch?: number; preparationDigest?: string; message?: string;
  actorUserId: UserId; reason?: string; createdAt: string; updatedAt: string;
  revision: number; owner: string | null; leaseUntil: string | null;
}
export function handoffSwitchDto(operation: ExecutionHandoffOperation): TrafficSwitchDto {
  return { id: operation.id, serviceId: operation.serviceId, fromSlot: 'preview', toSlot: 'prod', releaseId: operation.targetReleaseId,
    ...(operation.expectedActiveReleaseId ? { previousReleaseId: operation.expectedActiveReleaseId } : {}), actorUserId: operation.actorUserId,
    ...(operation.reason ? { reason: operation.reason } : {}), createdAt: operation.createdAt,
    handoff: { stage: operation.stage, ...(operation.epoch ? { epoch: operation.epoch } : {}), ...(operation.message ? { message: operation.message } : {}) } };
}
