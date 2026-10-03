import type { ProjectId } from '@crewstation/contracts';

/** Raw TaskRuntime bodies stay in the owner. A confirmed scope contains only original keys and digests. */
export interface RuntimeDeletionContent {
  readonly table: string;
  readonly key: string;
  readonly digest: string;
  readonly ownership: string;
}
export interface RuntimeDeletionOrigin {
  readonly complete: true;
  readonly id: string;
  readonly scope: 'project' | 'platform';
  readonly projectIds: readonly ProjectId[];
  readonly revision: string;
}
export interface RuntimeContentOrigin {
  readonly kind: 'project' | 'service' | 'task' | 'rebuild' | 'parent-ending';
  readonly key: string;
  readonly id: string;
  readonly projectId: ProjectId;
  readonly identity: string;
}
