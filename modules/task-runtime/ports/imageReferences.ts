export interface RuntimeImageReferenceQuery {
  readonly projectId: string;
  readonly versionId: string;
  readonly ownerType: string;
  readonly ownerId: string;
}
export type RuntimeImageReferenceState = 'active' | 'released' | 'unknown';
