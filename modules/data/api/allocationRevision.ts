import type { ObjectSpaceDto, ObjectStoragePlanDto } from '@crewstation/contracts';
import { jsonHash } from '@crewstation/kernel';

export const objectPlanAllocationRevision = (policyRevision: number, plan: ObjectStoragePlanDto) => jsonHash({ policyRevision, plan: { id: plan.id, revision: plan.revision, enabled: plan.enabled, backendId: plan.backendId, quotaBytes: plan.quotaBytes, maxObjectBytes: plan.maxObjectBytes, maxConcurrentTransfers: plan.maxConcurrentTransfers } });
export const objectSpaceAllocationRevision = (space: ObjectSpaceDto) => jsonHash({ id: space.id, quotaRevision: space.quotaRevision ?? 0, planRevision: space.planRevision, backendPlacementRevision: space.backendPlacementRevision, quotaBytes: space.quotaBytes, maxObjectBytes: space.maxObjectBytes, maxConcurrentTransfers: space.maxConcurrentTransfers });
