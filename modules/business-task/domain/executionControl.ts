import type { BusinessControlDto, BusinessControlLeaseRequest, BusinessExecutionFence, BusinessRecoveryExecution, ReleaseId } from '@crewstation/contracts';
import { conflict, forbidden, precondition } from '@crewstation/kernel';

export interface ExecutionAuthority {
  releaseId: ReleaseId; physicalSlot: 'blue' | 'green'; podUid: string; ready: boolean; role: 'prod' | 'preview';
}
export interface ExecutionAuthorization { source: ExecutionAuthority; fence?: BusinessExecutionFence; stopAuthority?: { operationId: string; epoch: number }; recovery?: BusinessRecoveryExecution }
export interface ExecutionHandoff {
  operationId: string; expectedActiveReleaseId: ReleaseId | null; targetReleaseId: ReleaseId; targetSlot: 'blue' | 'green';
  stage: 'frozen' | 'prepared' | 'routed' | 'complete'; acceptedTaskContractVersions?: string[];
}
export interface MigrationFreeze {
  operationId: string; targetReleaseId: ReleaseId; expectedActiveReleaseId: ReleaseId;
  preparationDigest?: string; receiptPodUid?: string;
}
export interface ExecutionControl extends Omit<BusinessControlDto, 'leaseId' | 'operationId' | 'migration'> {
  migration?: MigrationFreeze;
  serviceId: string; leaseId: string | null; leasePodUid: string | null; preparationDigest: string | null; handoff?: ExecutionHandoff;
}

export const CONTROL_LEASE_SECONDS = 30;
export function liveControl(control: ExecutionControl, now: Date): boolean {
  return control.leaseId !== null && control.leaseExpiresAt !== null && Date.parse(control.leaseExpiresAt) > now.getTime();
}
export function nextEpoch(epoch: number): number {
  if (!Number.isSafeInteger(epoch + 1)) throw precondition('执行世代已达安全上限');
  return epoch + 1;
}
export function staleControl(): never { throw conflict('执行权已变化，请重新读取控制状态', { code: 'stale_generation' }); }

export function assertControlSource(control: ExecutionControl, source: ExecutionAuthority): void {
  const handoff = control.handoff?.stage !== 'complete' ? control.handoff : undefined;
  if (source.releaseId !== (handoff?.targetReleaseId ?? control.activeReleaseId) || source.physicalSlot !== (handoff?.targetSlot ?? control.physicalSlot)) throw forbidden('此发布不拥有执行权');
  if (!source.ready) throw precondition('来源服务 Pod 尚未就绪', { code: 'source_not_ready' });
}
export function assertControlLease(control: ExecutionControl, source: ExecutionAuthority, input: BusinessControlLeaseRequest, now: Date): void {
  assertControlSource(control, source);
  if (!liveControl(control, now) || control.epoch !== input.expectedEpoch || control.leaseId !== input.leaseId || control.leaseOwner !== input.instanceId || control.leasePodUid !== source.podUid) staleControl();
}
export function assertExecutionFence(control: ExecutionControl | undefined, authorization: ExecutionAuthorization | undefined, now: Date): number {
  if (!control || !authorization?.fence) staleControl();
  const { source, fence } = authorization;
  assertControlLease(control, source, { ...fence, expectedEpoch: fence.epoch }, now);
  if (control.phase !== 'active' || (control.handoff && control.handoff.stage !== 'complete')) staleControl();
  return control.epoch;
}
export function controlDto(control: ExecutionControl | undefined, now: Date): BusinessControlDto {
  if (!control) return { activeReleaseId: null, physicalSlot: null, epoch: 1, phase: 'inactive', leaseOwner: null, leaseExpiresAt: null };
  const live = liveControl(control, now);
  return {
    ...(control.migration ? { migration: { operationId: control.migration.operationId, targetReleaseId: control.migration.targetReleaseId, applicationReady: !!control.migration.preparationDigest } } : {}),
    activeReleaseId: control.activeReleaseId, physicalSlot: control.physicalSlot, epoch: control.epoch,
    phase: !live && ['active', 'preparing'].includes(control.phase) ? (control.handoff && control.handoff.stage !== 'complete' ? 'frozen' : 'inactive') : control.phase,
    leaseOwner: live ? control.leaseOwner : null, leaseExpiresAt: live ? control.leaseExpiresAt : null,
    ...(live && control.leaseId ? { leaseId: control.leaseId } : {}), ...(control.handoff ? { operationId: control.handoff.operationId } : {}),
  };
}
