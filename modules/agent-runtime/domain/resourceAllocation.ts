import type { ProjectComputePolicy } from '@crewstation/contracts';

export interface ComputeAllocationReceipt { hash: string; revision: string; effect: string; applied: boolean }
export function allocateComputeProfile(policy: ProjectComputePolicy, id: string, grant: boolean): ProjectComputePolicy {
  const additionalProfiles = (policy.additionalProfiles ?? []).filter((key) => key !== id), excludedProfiles = (policy.excludedProfiles ?? []).filter((key) => key !== id);
  if (grant) additionalProfiles.push(id); else excludedProfiles.push(id);
  return { ...policy, additionalProfiles, excludedProfiles, ...(!grant && policy.defaultProfile === id ? { defaultProfile: null } : {}), ...(!grant && policy.defaultOverrideProfile === id ? { defaultOverrideProfile: null } : {}) };
}
