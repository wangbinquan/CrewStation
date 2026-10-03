import type { ProjectId } from '@crewstation/contracts';

/** Private metadata scope; the confirmation UI receives counts and digests, never execution payloads. */
export interface BusinessDeletionContent {
  readonly table: string;
  readonly key: string;
  readonly digest: string;
  readonly ownership: string;
}
export interface BusinessDeletionOrigin {
  readonly complete: true;
  readonly id: string;
  readonly scope: 'project' | 'platform';
  readonly projectIds: readonly ProjectId[];
  readonly revision: string;
}
/** Minimum immutable links used to reject late writes after recoverable content is removed. */
export interface BusinessContentOrigin {
  readonly kind: 'service' | 'task'; readonly key: string; readonly id: string;
  readonly projectId: ProjectId; readonly identity: string;
}
