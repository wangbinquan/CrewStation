import type { ImageReference } from '../domain/records';

/** released is an irreversible owner decision; absence or an unavailable owner is always unknown. */
export interface RuntimeImageReferenceOwners {
  inspect(input: { projectId: string; versionId: string; ownerType: ImageReference['ownerType']; ownerId: string }): Promise<'active' | 'released' | 'unknown'>;
}
