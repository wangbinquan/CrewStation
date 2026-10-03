import type { ProjectDeletionTarget, ProjectId } from '@crewstation/contracts';
import type { ScmWriteHistory } from './repositoryWrites';

export interface ScmCurrentNativeInstance {
  readonly id: string;
  readonly startedAt: string;
  readonly image: string;
  readonly epoch: string;
}
export interface ScmCurrentNativeToken {
  readonly id: string;
  readonly name: string;
  readonly userId: string;
  readonly createdAt: string;
  readonly expiresAt: string | null;
  readonly revoked: boolean;
  readonly scopes: readonly string[];
}
export interface ScmCurrentNativeRepository {
  readonly remoteProjectId: string;
  readonly pathWithNamespace: string;
  readonly createdAt: string;
  readonly apiTokens: readonly ScmCurrentNativeToken[];
  readonly nativeTokens: readonly ScmCurrentNativeToken[];
  readonly users: readonly { id: string; userType: 'project_bot'; createdAt: string; state: string }[];
  readonly memberships: readonly { id: string; userId: string; type: 'ProjectMember'; sourceType: 'Project'; sourceId: string; createdAt: string }[];
  readonly relatedTokens: readonly ScmCurrentNativeToken[];
}
/** Reads must include inactive/revoked tokens, every bot membership and every related personal token. */
export interface ScmCurrentRepositoryOriginsSource {
  read(target: ProjectDeletionTarget, history: ScmWriteHistory): Promise<{
    readonly version: 'gitlab-native/19.2.4/v1';
    readonly before: ScmCurrentNativeInstance;
    readonly after: ScmCurrentNativeInstance;
    readonly repositories: readonly ScmCurrentNativeRepository[];
  }>;
}
/** Current birth and ownership facts are separate from historical callback results. */
export interface ScmCurrentRepositoryOriginsWitness {
  readonly version: 1;
  readonly projectId: ProjectId;
  readonly historyRevision: string;
  readonly source: { readonly identity: string; readonly epoch: string; readonly version: string };
  readonly repositories: readonly { remoteProjectId: string; pathWithNamespace: string; createdAt: string; identity: string }[];
  readonly credentials: readonly { platformCredentialId: string | null; remoteProjectId: string; remoteTokenId: string;
    createdAt: string; userId: string; userCreatedAt: string; membershipId: string; membershipCreatedAt: string;
    historicalCreatedAt: string | null; historicalUserId: string | null }[];
  readonly historicalCallbacksReconstructed: false;
  readonly digest: string;
}
