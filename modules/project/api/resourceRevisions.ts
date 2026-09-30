import type { NamespaceQuota, ProjectServicePolicy, ServicePlanDto } from '@crewstation/contracts';
import { jsonHash } from '@crewstation/kernel';

/** Public revision contract shared by inspectors and the domain writer. */
export const namespaceQuotaRevision = (revision: number, quota: NamespaceQuota) => jsonHash({ revision, quota });
export const serviceAllocationRevision = (revision: number, plan: ServicePlanDto) => jsonHash({ revision, plan });
export const executionQuotaRevision = (maxConcurrentTasks: number) => jsonHash({ maxConcurrentTasks });
export const servicePlanAllowed = (policy: ProjectServicePolicy, id: string) => Boolean((policy.mode === 'inherit' || policy.allowedPlanIds.includes(id) || policy.additionalPlanIds?.includes(id)) && !policy.excludedPlanIds?.includes(id));
