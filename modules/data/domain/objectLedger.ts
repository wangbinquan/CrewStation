import type { ProjectId, ResourceConditionStatus } from '@crewstation/contracts';
import type { ObjectBackendRecord, ObjectSpaceRecord } from './objectStorage';

export interface ObjectSpaceDeclaration {
  id: string; kind: 'object-space'; ref: string; projectId: ProjectId;
  spec: { children: []; serviceId: string; env: string; backendId: string; placementRevision: number; planId: string; planRevision: number; quotaBytes: number };
  display: Record<string, string>; conditions: Array<{ type: string; status: ResourceConditionStatus; reason: string; message: string }>;
}
/** Object spaces have no PVC children. They survive service slots and retain their ownership. */
export function objectSpaceDeclaration(space: ObjectSpaceRecord, backend: ObjectBackendRecord | undefined, now: Date): ObjectSpaceDeclaration {
  const stale = !backend?.observedAt || now.getTime() - Date.parse(backend.observedAt) > 120_000;
  const health = backend?.state === 'offline' ? 'unavailable' : stale ? 'unknown' : backend?.health === 'ready' ? space.health : backend?.health ?? 'unknown';
  const message = health === 'ready' ? '对象空间已就绪' : health === 'unknown' ? '等待对象后端健康观测' : backend?.message ?? '对象数据或后端异常，请在对象存储页面查看';
  return { id: space.id, kind: 'object-space', ref: space.id, projectId: space.projectId,
    spec: { children: [], serviceId: space.serviceId, env: space.env, backendId: space.backendId, placementRevision: space.backendPlacementRevision, planId: space.planId, planRevision: space.planRevision, quotaBytes: space.quotaBytes },
    display: { serviceId: space.serviceId, env: space.env, backendId: space.backendId, backend: backend?.name ?? space.backendId, health,
      quotaBytes: String(space.quotaBytes), usedBytes: String(space.usedBytes), reservedBytes: String(space.reservedBytes), deletingBytes: String(space.deletingBytes),
      objectCount: String(space.objectCount), observedAt: backend?.observedAt ?? '', envVar: 'CS_OBJECT_SPACE_ID' },
    conditions: [{ type: 'ObjectStorageReady', status: health === 'ready' ? 'true' : health === 'unknown' ? 'unknown' : 'false', reason: `object-health-${health}`, message }],
  };
}
