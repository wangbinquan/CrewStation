import type { ReleaseId, ServiceId } from '@crewstation/contracts';

interface Request { operationId: string; expectedActiveReleaseId: ReleaseId | null; targetReleaseId: ReleaseId; targetSlot: 'blue' | 'green' }
interface Snapshot { operationId?: string; epoch: number; stage: 'inactive' | 'frozen' | 'prepared' | 'routed' | 'complete'; quiescent: boolean; targetReleaseId?: ReleaseId; targetSlot?: 'blue' | 'green'; migration?: { operationId: string; targetReleaseId: ReleaseId; expectedActiveReleaseId: ReleaseId }; preparationDigest?: string }
export interface BusinessHandoffBinding {
  releaseHandoff: {
    migrationBarrier(serviceId: ServiceId, request: { operationId: string; targetReleaseId: ReleaseId; expectedActiveReleaseId: ReleaseId; supersedesOperationId?: string }): Promise<{ ready: boolean; epoch: number; blocked: string[]; preparationDigest?: string }>;
    precheck(serviceId: ServiceId, targetReleaseId: ReleaseId): Promise<{ supported: boolean; blocked: Array<{ taskId: string; taskContractVersion: string }> }>;
    freeze(serviceId: ServiceId, request: Request): Promise<Snapshot>;
    inspect(serviceId: ServiceId): Promise<Snapshot>;
    routeObserved(serviceId: ServiceId, request: Request): Promise<Snapshot>;
  };
}
export interface GatewayHandoffBinding { productionRouteObserved(serviceId: ServiceId, physical: 'blue' | 'green'): Promise<boolean> }
export interface ReleaseHandoffBinding { activeEndpoint(serviceId: ServiceId): Promise<{ physical: 'blue' | 'green'; releaseId?: ReleaseId } | undefined> }
