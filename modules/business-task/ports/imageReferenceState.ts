/** Internal owner proof for runtime-image reclamation. Absence and ambiguous admission are unknown. */
export interface ImageReferenceQuery { projectId: string; versionId: string; ownerType: string; ownerId: string }
export type ImageReferenceState = 'active' | 'released' | 'unknown';
