import type { ReleaseDto, SlotDto, TrafficSwitchDto } from '@crewstation/contracts';
import type { Release } from '../domain/release';
import { isRedeployable } from '../domain/release';
import type { OfflinePolicy } from '../domain/slotLifecycle';
import { DEFAULT_OFFLINE_POLICY, offlineDeadline, retentionPeriodMs } from '../domain/slotLifecycle';
import type { PhysicalSlot, ServiceSlots, SlotState } from '../domain/slots';
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
    redeployable: isRedeployable(release, !!onSlot),
    createdBy: release.createdBy,
    createdAt: release.createdAt.toISOString(),
    updatedAt: release.updatedAt.toISOString(),
  };
}

/** 待命槽的计时与下线记录（RFC-021）：到期时间按当前平台策略即时算好，下线记录带上版本号。 */
function lifecycleOf(slot: SlotState, role: 'prod' | 'preview', releases: Map<string, Release>, policy: OfflinePolicy): Pick<SlotDto, 'retention' | 'offline'> {
  const retention = slot.retention && role === 'preview' ? {
    retention: {
      kind: slot.retention.kind, since: slot.retention.since.toISOString(), deadline: offlineDeadline(slot.retention, policy).toISOString(),
      ...(slot.retention.remindedAt && slot.retention.remindedFor?.getTime() === offlineDeadline(slot.retention, policy).getTime() ? { remindedAt: slot.retention.remindedAt.toISOString() } : {}),
      postponements: slot.retention.postponements, periodHours: retentionPeriodMs(slot.retention.kind, policy) / 3_600_000,
    },
  } : {};
  const tag = slot.offline ? releases.get(slot.offline.releaseId)?.tag : undefined;
  const offline = slot.offline ? {
    offline: { releaseId: slot.offline.releaseId, ...(tag ? { tag } : {}), at: slot.offline.at.toISOString(), reason: slot.offline.reason, ...(slot.offline.actorUserId ? { actorUserId: slot.offline.actorUserId } : {}) },
  } : {};
  return { ...retention, ...offline };
}

export function slotToDto(slots: ServiceSlots, physical: PhysicalSlot, releases: Map<string, Release>, projectSlug: string, hosts: HostNaming, policy: OfflinePolicy = DEFAULT_OFFLINE_POLICY): SlotDto {
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
    ...lifecycleOf(slot, role, releases, policy),
  };
}

export function switchToDto(record: TrafficSwitchRecord): TrafficSwitchDto {
  return {
    id: record.id,
    serviceId: record.serviceId,
    fromSlot: record.fromSlot,
    toSlot: record.toSlot,
    releaseId: record.releaseId,
    ...(record.previousReleaseId ? { previousReleaseId: record.previousReleaseId } : {}),
    actorUserId: record.actorUserId,
    ...(record.reason ? { reason: record.reason } : {}),
    createdAt: record.createdAt.toISOString(),
  };
}
