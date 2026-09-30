import { jsonHash } from '@crewstation/kernel';

export const computeAllocationRevision = (policyRevision: number, profile: { id: string; revision: number; enabled: boolean; defaultVisible?: boolean }) => jsonHash({ policyRevision, id: profile.id, revision: profile.revision, enabled: profile.enabled, defaultVisible: profile.defaultVisible !== false });
export const taskProfileAllocationRevision = (policyRevision: number, id: string) => jsonHash({ policyRevision, taskProfileId: id });
