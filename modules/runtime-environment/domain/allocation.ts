import type { ProjectRuntimeImagePolicy } from '@crewstation/contracts';

export interface ImageAllocationReceipt { hash: string; revision: string; effect: string; applied: boolean }
export function allocateImage(policy: ProjectRuntimeImagePolicy, id: string, grant: boolean): ProjectRuntimeImagePolicy {
  const additionalImageIds = (policy.additionalImageIds ?? []).filter((key) => key !== id), excludedImageIds = (policy.excludedImageIds ?? []).filter((key) => key !== id);
  if (grant) additionalImageIds.push(id); else excludedImageIds.push(id);
  return { ...policy, additionalImageIds, excludedImageIds };
}
