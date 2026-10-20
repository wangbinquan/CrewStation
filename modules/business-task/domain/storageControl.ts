import { ServiceIdSchema, type ServiceId } from '@crewstation/contracts';
import type { ExecutionControl } from './executionControl';

export interface StorageControlUpdate {
  readonly serviceId: ServiceId;
  readonly controlVersion: number;
  readonly epoch: number;
  readonly leaseId: string;
  readonly instanceId: string;
  readonly podUid: string | null;
  readonly leaseUntil: string;
  readonly phase: 'active' | 'frozen';
}
/** Who may write objects under a control version; a later version that keeps it only moves `leaseUntil` (a renewal). */
export type StorageWriteAuthority = Pick<StorageControlUpdate, 'epoch' | 'leaseId' | 'instanceId' | 'podUid' | 'phase'>;
export function storageWriteAuthority(control: ExecutionControl): StorageWriteAuthority {
  return { epoch: control.epoch, leaseId: control.leaseId ?? '', instanceId: control.leaseOwner ?? '', podUid: control.leasePodUid,
    phase: control.phase === 'active' && !control.migration && (!control.handoff || control.handoff.stage === 'complete') ? 'active' : 'frozen' };
}
export function sameStorageWriteAuthority(left: ExecutionControl, right: ExecutionControl): boolean {
  const a = storageWriteAuthority(left), b = storageWriteAuthority(right);
  return a.epoch === b.epoch && a.leaseId === b.leaseId && a.instanceId === b.instanceId && a.podUid === b.podUid && a.phase === b.phase;
}
export function storageControlUpdate(control: ExecutionControl): StorageControlUpdate {
  const { epoch, leaseId, instanceId, podUid, phase } = storageWriteAuthority(control);
  return { serviceId: ServiceIdSchema.parse(control.serviceId), controlVersion: control.storageSync!.version, epoch,
    leaseId, instanceId, podUid, leaseUntil: control.leaseExpiresAt ?? '1970-01-01T00:00:00.000Z', phase };
}
