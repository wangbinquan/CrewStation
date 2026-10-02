import type { ProjectDeletionContext, ProjectId, ServiceId } from '@crewstation/contracts';

export type ScmWriteKind = 'ensure-repository' | 'session-credential' | 'build-credential' | 'credential-revoke' | 'release-tag' | 'push-branch' | 'repository-url';
export interface ScmCallbackProcess { readonly podUid: string; readonly containerId: string; readonly nodeUid: string; readonly nodeName: string }
export interface ScmCallbackProcesses {
  protectCurrent(): Promise<ScmCallbackProcess>;
  sweep(accept: { stopped(process: ScmCallbackProcess, digest: string): Promise<void>; releasable(podUid: string): Promise<boolean> }): Promise<void>;
}
export interface ScmExternalEffect {
  readonly intentId: string; readonly kind: 'repository' | 'credential'; readonly stage: 'intent' | 'returned';
  readonly remoteProjectId?: string; readonly remoteTokenId?: string; readonly path?: string; readonly credentialId?: string; readonly createdAt?: string; readonly userId?: string;
}
export interface ScmWriteRecord {
  readonly id: string; readonly serviceId: ServiceId; readonly kind: ScmWriteKind; readonly state: 'running' | 'exited';
  readonly remoteProjectId: string | null; readonly backendPid: number; readonly callbackPid: number; readonly callbackStartedAt: string;
  readonly process: ScmCallbackProcess | null; readonly result: 'succeeded' | 'failed' | 'interrupted' | null;
  readonly exitDigest: string | null; readonly effects: readonly ScmExternalEffect[];
}
export interface ScmWriteHistory {
  readonly revision: string; readonly metadataComplete: boolean; readonly metadataCount: number;
  readonly bindings: readonly { serviceId: ServiceId; remoteProjectId: string; pathWithNamespace: string; bindingCreatedAt: string }[];
  readonly credentials: readonly { id: string; serviceId: ServiceId; remoteTokenId: string }[];
  readonly origins: readonly { serviceId: ServiceId; remoteProjectId: string; pathWithNamespace: string; createdAt: string | null; source: 'legacy-binding' | 'callback-result' }[];
  readonly records: readonly ScmWriteRecord[];
  readonly identities: readonly { kind: 'service' | 'credential'; id: string; serviceId: string }[];
  readonly unresolvedEffects: readonly { workId: string; intentId: string }[];
  readonly unownedCredentialIds: readonly string[];
  readonly foreignRepositoryReferences: readonly { remoteProjectId: string; projectId: ProjectId }[];
}
export interface RepositoryWrites {
  assertOriginalActive(): void;
  observe(): Promise<void>;
  withAdmission<T>(projectId: ProjectId, serviceId: ServiceId, kind: ScmWriteKind, work: () => Promise<T>): Promise<T>;
  record(effect: ScmExternalEffect): Promise<void>;
  history(projectId: ProjectId, originalRepositories?: readonly string[]): Promise<ScmWriteHistory>;
  /** Closing admission alone is not a successful owner phase or physical proof. */
  close(context: ProjectDeletionContext): Promise<void>;
  recover(context: ProjectDeletionContext): Promise<void>;
}
