import { jsonHash } from '@crewstation/kernel';

export const imageAllocationRevision = (policyRevision: number, image: { id: string; revision: number; enabled: boolean; defaultVisible: boolean }) => jsonHash({ policyRevision, id: image.id, revision: image.revision, enabled: image.enabled, defaultVisible: image.defaultVisible });
