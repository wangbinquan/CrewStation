import type { ReleaseId, ServiceId } from '@crewstation/contracts';

/** Internal reverse port: release owns orchestration; business-task owns execution authority. */
export interface ReleaseHandoffRequest { operationId: string; expectedActiveReleaseId: ReleaseId | null; targetReleaseId: ReleaseId; targetSlot: 'blue' | 'green' }
export interface ReleaseHandoffSnapshot {
  operationId?: string; epoch: number; stage: 'inactive' | 'frozen' | 'prepared' | 'routed' | 'complete'; quiescent: boolean;
  targetReleaseId?: ReleaseId; targetSlot?: 'blue' | 'green'; preparationDigest?: string;
  migration?: { operationId: string; targetReleaseId: ReleaseId; expectedActiveReleaseId: ReleaseId };
}
export interface BusinessReleaseHandoff {
  migrationBarrier(serviceId: ServiceId, request: { operationId: string; targetReleaseId: ReleaseId; expectedActiveReleaseId: ReleaseId; supersedesOperationId?: string }): Promise<{ ready: boolean; epoch: number; blocked: string[]; preparationDigest?: string }>;
  precheck(serviceId: ServiceId, targetReleaseId: ReleaseId): Promise<{ supported: boolean; blocked: Array<{ taskId: string; taskContractVersion: string }> }>;
  freeze(serviceId: ServiceId, request: ReleaseHandoffRequest): Promise<ReleaseHandoffSnapshot>;
  inspect(serviceId: ServiceId): Promise<ReleaseHandoffSnapshot>;
  routeObserved(serviceId: ServiceId, request: ReleaseHandoffRequest): Promise<ReleaseHandoffSnapshot>;
}
