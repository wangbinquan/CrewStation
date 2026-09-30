import type { ProjectId, ServiceId } from '@crewstation/contracts';

export interface ApiAllocationReceipt { hash: string; revision: string; effect: string; applied: boolean }
export interface ApiAllocations {
  bindService(serviceId: ServiceId, projectId: ProjectId): Promise<void>;
  get(serviceId: ServiceId, operationId: string): Promise<ApiAllocationReceipt | undefined>;
  save(serviceId: ServiceId, operationId: string, receipt: ApiAllocationReceipt): Promise<void>;
  lock(serviceId: ServiceId): Promise<void>;
}
