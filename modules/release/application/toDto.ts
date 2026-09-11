import type { ReleaseDto, SlotDto, TrafficSwitchDto } from '@crewstation/contracts';
import type { Release } from '../domain/release';
import type { PhysicalSlot, ServiceSlots } from '../domain/slots';
import { roleOf } from '../domain/slots';
import type { HostNaming } from '../ports/platform';
import type { TrafficSwitchRecord } from '../ports/repositories';

export function releaseToDto(release: Release, slots: ServiceSlots | undefined): ReleaseDto {
  const onSlot = slots && (['blue', 'green'] as PhysicalSlot[]).find((p) => slots[p].releaseId === release.id);
  return {
    id: release.id,
    serviceId: release.serviceId,
    tag: release.tag,
    commitSha: release.commitSha,
    branch: release.branch,
    ...(release.image ? { image: release.image } : {}),
    status: release.status,
    ...(onSlot && slots ? { slot: roleOf(slots, onSlot) } : {}),
    ...(release.configVersion !== undefined ? { configVersion: release.configVersion } : {}),
    ...(release.message ? { message: release.message } : {}),
    createdBy: release.createdBy,
    createdAt: release.createdAt.toISOString(),
    updatedAt: release.updatedAt.toISOString(),
  };
}

export function slotToDto(slots: ServiceSlots, physical: PhysicalSlot, releases: Map<string, Release>, projectSlug: string, hosts: HostNaming): SlotDto {
  const slot = slots[physical];
  const role = roleOf(slots, physical);
  const release = slot.releaseId ? releases.get(slot.releaseId) : undefined;
  return {
    name: role,
    active: role === 'prod',
    ...(slot.releaseId ? { releaseId: slot.releaseId } : {}),
    ...(release ? { tag: release.tag, commitSha: release.commitSha } : {}),
    replicas: slot.replicas,
    readyReplicas: slot.readyReplicas,
    state: slot.state,
    host: role === 'prod' ? hosts.prodHost(projectSlug) : hosts.previewHost(projectSlug),
  };
}

export function switchToDto(record: TrafficSwitchRecord): TrafficSwitchDto {
  return {
    id: record.id,
    serviceId: record.serviceId,
    fromSlot: record.fromSlot,
    toSlot: record.toSlot,
    releaseId: record.releaseId,
    actorUserId: record.actorUserId,
    ...(record.reason ? { reason: record.reason } : {}),
    createdAt: record.createdAt.toISOString(),
  };
}
