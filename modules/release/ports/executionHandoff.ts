import type { ReleaseId, ServiceId } from '@crewstation/contracts';
import type { ExecutionHandoffOperation } from '../domain/executionHandoff';

export interface HandoffRequest { operationId: string; expectedActiveReleaseId: ReleaseId | null; targetReleaseId: ReleaseId; targetSlot: 'blue' | 'green' }
export interface HandoffAuthority {
  operationId?: string; epoch: number; stage: 'inactive' | 'frozen' | 'prepared' | 'routed' | 'complete'; quiescent: boolean;
  targetReleaseId?: ReleaseId; targetSlot?: 'blue' | 'green'; migration?: { operationId: string; targetReleaseId: ReleaseId; expectedActiveReleaseId: ReleaseId }; preparationDigest?: string;
}
/** Supplied by platform: release does not import business-task or gateway. */
export interface ExecutionHandoff {
  migrationBarrier?(serviceId: ServiceId, request: { operationId: string; targetReleaseId: ReleaseId; expectedActiveReleaseId: ReleaseId; supersedesOperationId?: string }): Promise<{ ready: boolean; epoch: number; blocked: string[]; preparationDigest?: string }>;
  observeMigrationStopped?(serviceId: ServiceId, releaseId: ReleaseId, requireSuspendedJob?: boolean): Promise<boolean>;
  observeWritersStopped?(serviceId: ServiceId, includeServices?: boolean): Promise<boolean>;
  precheck(serviceId: ServiceId, targetReleaseId: ReleaseId): Promise<{ supported: boolean; blocked: Array<{ taskId: string; taskContractVersion: string }> }>;
  freeze(serviceId: ServiceId, request: HandoffRequest): Promise<HandoffAuthority>;
  inspect(serviceId: ServiceId): Promise<HandoffAuthority>;
  routeObserved(serviceId: ServiceId, request: HandoffRequest): Promise<HandoffAuthority>;
  /** True only when gateway has observed the expected production route in the cluster. */
  observeRoute(serviceId: ServiceId, targetReleaseId: ReleaseId, targetSlot: 'blue' | 'green'): Promise<boolean>;
}
export interface HandoffRepository {
  findByKey(serviceId: ServiceId, requestKey: string): Promise<ExecutionHandoffOperation | undefined>;
  get(id: string): Promise<ExecutionHandoffOperation | undefined>;
  active(serviceId: ServiceId): Promise<ExecutionHandoffOperation | undefined>;
  latest(serviceId: ServiceId): Promise<ExecutionHandoffOperation | undefined>;
  insert(operation: ExecutionHandoffOperation): Promise<void>;
  /** 有界页按不可变原 ID 排序；afterId 只推进扫描，不认领或改写被拒绝的项目。 */
  pending(limit: number, afterId?: string): Promise<ExecutionHandoffOperation[]>;
  claim(id: string, owner: string): Promise<ExecutionHandoffOperation | undefined>;
  settle(claim: ExecutionHandoffOperation, update: Pick<ExecutionHandoffOperation, 'stage'> & Partial<Pick<ExecutionHandoffOperation, 'epoch' | 'preparationDigest' | 'message'>>): Promise<boolean>;
}
