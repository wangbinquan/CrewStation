import type { MigrationFreeze } from '../domain/executionControl';
import type { BusinessMigrationReady } from '@crewstation/contracts';
import type { BusinessControlActivate, BusinessControlClaim, BusinessControlLeaseRequest, BusinessHandoffReady, ReleaseId } from '@crewstation/contracts';
import type { ExecutionAuthority, ExecutionControl } from '../domain/executionControl';

export interface ControlSnapshot { control: ExecutionControl | undefined; now: Date }
export interface FreezeExecutionInput {
  operationId: string; expectedActiveReleaseId: ReleaseId | null; targetReleaseId: ReleaseId; targetSlot: 'blue' | 'green';
}
export interface ExecutionControls {
  freezeMigration(serviceId: string, input: Omit<MigrationFreeze, 'preparationDigest' | 'receiptPodUid'> & { supersedesOperationId?: string }): Promise<ControlSnapshot>;
  migrationReady(serviceId: string, source: ExecutionAuthority, input: BusinessMigrationReady): Promise<ControlSnapshot>;
  writerRuntimes(serviceId: string): Promise<string[]>;
  activeTaskContracts(serviceId: string): Promise<Array<{ taskId: string; taskContractVersion: string }>>;
  quiescent(serviceId: string): Promise<boolean>;
  read(serviceId: string): Promise<ControlSnapshot>;
  claim(serviceId: string, source: ExecutionAuthority, input: BusinessControlClaim): Promise<ControlSnapshot>;
  renew(serviceId: string, source: ExecutionAuthority, input: BusinessControlLeaseRequest): Promise<ControlSnapshot>;
  release(serviceId: string, source: ExecutionAuthority, input: BusinessControlLeaseRequest): Promise<ControlSnapshot>;
  activate(serviceId: string, source: ExecutionAuthority, input: BusinessControlActivate): Promise<ControlSnapshot>;
  freeze(serviceId: string, input: FreezeExecutionInput): Promise<ControlSnapshot & { quiescent: boolean }>;
  handoffReady(serviceId: string, source: ExecutionAuthority, input: BusinessHandoffReady): Promise<ControlSnapshot>;
  routeObserved(serviceId: string, operationId: string, releaseId: ReleaseId, slot: 'blue' | 'green'): Promise<ControlSnapshot>;
}
