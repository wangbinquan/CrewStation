import type { Actor, BeforeStartMaterial, ComputeProfileSelector, ComputeUsage, ConfigEnv, ProjectId, ProfileRevisionRef, RegistryPushCredential, RuntimeImageSecretVersion, RuntimeImageSource, ServiceId, UserId } from '@crewstation/contracts';

export interface RuntimeImagePlatformPorts {
  readonly project: {
    authorize(actor: Actor, id: ProjectId, action: 'view' | 'develop' | 'manage-production-config'): Promise<unknown>;
    getProject(actor: Actor, id: ProjectId): Promise<{ slug: string; namespace: string }>;
  };
  readonly scm: {
    resolveBuildSource(actor: Actor, projectId: ProjectId, bindingId: ServiceId, ref: string): Promise<{ commitSha: string; httpUrl: string; tree: readonly { path: string; mode: string; type: 'tree' | 'blob' | 'commit' }[] }>;
    readFile(bindingId: ServiceId, ref: string, path: string): Promise<string | undefined>;
    issueBuildCredential(bindingId: ServiceId, ttlMinutes: number): Promise<{ id: string; token: string }>;
    revokeBuildCredential(bindingId: ServiceId, id: string): Promise<void>;
  };
  readonly config: { renderPinnedSecretDefinitions(projectId: ProjectId, env: ConfigEnv, stamps: readonly Omit<RuntimeImageSecretVersion, 'environment'>[]): Promise<Record<string, string>>; secretDefinitionVersions(actor: Actor, projectId: ProjectId, env: ConfigEnv, ids: readonly string[]): Promise<Array<{ definitionId: string; itemId: string; version: number }>>; renderSecretDefinitions(actor: Actor, projectId: ProjectId, env: ConfigEnv, ids: readonly string[]): Promise<Record<string, string>> };
  readonly compute: {
    resolveForProject(projectId: ProjectId, selector: ComputeProfileSelector, usage: ComputeUsage): Promise<{ id: string; revision: number; image: string }>;
    launchMaterial(ref: ProfileRevisionRef): Promise<{ beforeStart: BeforeStartMaterial; image: string }>;
    issueBuildPushCredential(input: { projectId?: string; buildId: string; expiresAt: string; pullRepositories: readonly string[] }): Promise<RegistryPushCredential>;
  };
  isAdmin(id: UserId): Promise<boolean>;
}
export interface RuntimeBuildIdentity { readonly id: string; readonly projectId?: string; readonly sourceProjectId?: string; readonly createdBy: string; readonly deadline: string }
export interface RuntimeBuildSource { readonly source: RuntimeImageSource; readonly sourceProjectId?: string; readonly commitSha?: string; readonly baseImage?: string }
export interface RuntimeImagePlatformSettings {
  readonly systemNamespace?: string;
  readonly serviceDomain: string; readonly registryBase: string; readonly registryPushHost: string; readonly registryScheme: 'http' | 'https';
  readonly baseImage: { repository: string; tag: string }; readonly taskImage: string; readonly builderImage: string;
}
