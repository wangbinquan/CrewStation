import type { NamespaceQuota, ProjectServicePolicy } from '@crewstation/contracts';

export const DEFAULT_NAMESPACE_QUOTA: NamespaceQuota = { requestsCpu: 8, requestsMemoryGiB: 16, pods: 30, persistentVolumeClaims: 20 };

export function allocateServicePlan(policy: ProjectServicePolicy, id: string, grant: boolean): ProjectServicePolicy {
  const additionalPlanIds = (policy.additionalPlanIds ?? []).filter((key) => key !== id), excludedPlanIds = (policy.excludedPlanIds ?? []).filter((key) => key !== id);
  if (grant) additionalPlanIds.push(id);
  else excludedPlanIds.push(id);
  return { ...policy, additionalPlanIds, excludedPlanIds };
}
