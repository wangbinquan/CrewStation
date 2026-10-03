import type { ProjectId } from '@crewstation/contracts';

/** Private row scopes contain no workspace, prompt, terminal or usage payload. */
export interface DevelopmentDeletionContent {
  readonly table: string;
  readonly key: string;
  readonly digest: string;
  readonly ownership: string;
}
export interface DevelopmentDeletionOrigin {
  readonly complete: true;
  readonly id: string;
  readonly scope: 'project' | 'platform';
  readonly projectIds: readonly ProjectId[];
  readonly revision: string;
}
/** These links describe original ownership; they do not prove a physical process stopped. */
export interface DevelopmentContentOrigin {
  readonly kind: 'project' | 'task' | 'cluster-operation';
  readonly key: string;
  readonly id: string;
  readonly projectId: ProjectId;
  readonly identity: string;
}
