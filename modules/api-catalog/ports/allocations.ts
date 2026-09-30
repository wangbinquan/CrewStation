import type { ServiceId } from '@crewstation/contracts';

export interface ApiAllocationReceipt { hash: string; revision: string; effect: string; applied: boolean }
export interface ApiAllocations {
  get(serviceId: ServiceId, operationId: string): Promise<ApiAllocationReceipt | undefined>;
  save(serviceId: ServiceId, operationId: string, receipt: ApiAllocationReceipt): Promise<void>;
  lock(serviceId: ServiceId): Promise<void>;
}
