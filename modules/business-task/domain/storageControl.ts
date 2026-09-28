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
export function storageControlUpdate(control: ExecutionControl): StorageControlUpdate {
  return { serviceId: ServiceIdSchema.parse(control.serviceId), controlVersion: control.storageSync!.version, epoch: control.epoch,
    leaseId: control.leaseId ?? '', instanceId: control.leaseOwner ?? '', podUid: control.leasePodUid,
    leaseUntil: control.leaseExpiresAt ?? '1970-01-01T00:00:00.000Z',
    phase: control.phase === 'active' && !control.migration && (!control.handoff || control.handoff.stage === 'complete') ? 'active' : 'frozen' };
}
