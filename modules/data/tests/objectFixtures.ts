import type { ProjectId, ServiceId } from '@crewstation/contracts';
import type { ObjectBackendRecord, ObjectSource, ObjectSpaceRecord, ObjectWriteControl } from '../domain/objectStorage';

export const objectId = (): string => Bun.randomUUIDv7();
export const storageNow = '2026-09-28T00:00:00.000Z';
export function backendFixture(overrides: Partial<ObjectBackendRecord> = {}): ObjectBackendRecord {
  return {
    id: objectId(), name: 'Test objects', endpoint: 'http://garage:3900', region: 'garage', bucket: 'crewstation-objects',
    revision: 1, placementRevision: 1, credentialRevision: 1, state: 'active', health: 'unknown', durability: 'dev-only',
    durabilityVerifiedAt: null, budgetBytes: 10_000, reservedBytes: 0, physicalFreeBytes: null, physicalTotalBytes: null,
    observedAt: null, message: null, createdAt: storageNow, requestKey: objectId(), requestDigest: 'a'.repeat(64), activeTransfers: 0,
    ...overrides,
  };
}
export function sourceFixture(): ObjectSource {
  const serviceId = objectId() as ServiceId;
  return { projectId: objectId() as ProjectId, serviceId, podUid: `pod-${serviceId}`, env: 'production', fenced: false };
}
export function spaceFixture(backendId: string, source = sourceFixture(), overrides: Partial<ObjectSpaceRecord> = {}): ObjectSpaceRecord {
  return {
    id: objectId(), projectId: source.projectId, serviceId: source.serviceId, env: source.env, backendId,
    backendPlacementRevision: 1, planId: objectId(), planRevision: 1, revision: 1, health: 'ready', quotaBytes: 1000,
    usedBytes: 0, reservedBytes: 0, deletingBytes: 0, objectCount: 0, maxObjectBytes: 1000, maxConcurrentTransfers: 4,
    activeTransfers: 0, enabled: true, createdAt: storageNow, ...overrides,
  };
}
export function controlFixture(serviceId: ServiceId, overrides: Partial<ObjectWriteControl> = {}): ObjectWriteControl {
  return { serviceId, controlVersion: 1, epoch: 1, leaseId: objectId(), instanceId: objectId(), podUid: `pod-${serviceId}`, leaseUntil: '2099-01-01T00:00:00.000Z', phase: 'active', ...overrides };
}
