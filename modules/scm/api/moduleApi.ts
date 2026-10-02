import type {
  Actor, BranchDto, CreateReleaseTagRequest, ManifestUpgradePreview, ProjectDeletionContext, ProjectId, ProjectTemplateDto, ReleaseTagDto, RepositoryBindingDto, ServiceId, SessionCredentialDto, TagDto, UserId,
} from '@crewstation/contracts';

export interface EnsureRepositoryInput {
  readonly slug: string;
  readonly templateId: string;
  readonly initialPlan?: string;
}

export interface ListBranchesOptions {
  readonly previewSha?: string;
  readonly prodSha?: string;
}

/** http 层把网关注入的用户 ID 变成用例层 Actor；管理员标记来自 project 模块。 */
export type ActorResolver = (userId: UserId) => Promise<Actor>;

/** scm 模块对外能力；不带 actor 的方法只供平台内部（控制面、其他模块）调用。 */
export interface ScmModuleApi {
  readonly name: 'scm';
  /** Internal retained facts; admission closure and callback exit alone do not prove provider/storage reclamation. */
  readonly repositoryWrites?: {
    history(projectId: ProjectId): Promise<ScmRepositoryWriteHistory>;
    close(context: ProjectDeletionContext): Promise<void>;
    recover(context: ProjectDeletionContext): Promise<void>;
  };
  listTemplates(actor: Actor): Promise<ProjectTemplateDto[]>;
  previewManifestUpgrade(actor: Actor, serviceId: ServiceId, content: string): Promise<ManifestUpgradePreview>;
  /** 幂等建仓：已有绑定直接返回；远端路径被占且不属于本服务时抛 conflict，绝不接管（R32）。 */
  ensureRepository(serviceId: ServiceId, projectId: ProjectId, input: EnsureRepositoryInput): Promise<RepositoryBindingDto>;
  getBinding(actor: Actor, serviceId: ServiceId): Promise<RepositoryBindingDto>;
  /** 各分支 HEAD 与两槽部署提交的落后数；未给出某槽的提交时该项为 null。 */
  listBranches(actor: Actor, serviceId: ServiceId, options?: ListBranchesOptions): Promise<BranchDto[]>;
  listTags(actor: Actor, serviceId: ServiceId): Promise<TagDto[]>;
  readFile(serviceId: ServiceId, ref: string, path: string): Promise<string | undefined>;
  /** 构建固定输入：绑定 ID 就是所属服务 ID，先核对路径项目与 develop 权限。 */
  resolveBuildSource(actor: Actor, projectId: ProjectId, bindingId: ServiceId, ref: string): Promise<{ commitSha: string; httpUrl: string; tree: readonly { path: string; mode: string; type: 'tree' | 'blob' | 'commit' }[] }>;
  issueBuildCredential(serviceId: ServiceId, ttlMinutes: number): Promise<SessionCredentialDto & { id: string }>;
  revokeBuildCredential(serviceId: ServiceId, credentialId: string): Promise<void>;
  /** 以平台令牌在分支 HEAD 上打 `v<major>.<minor>.<patch>`；业务用户没有打标权。 */
  createReleaseTag(serviceId: ServiceId, input: CreateReleaseTagRequest): Promise<ReleaseTagDto>;
  /** 签发会话级短期 Git 凭据；明文只返回这一次，平台只存哈希。 */
  issueSessionCredential(serviceId: ServiceId, ttlMinutes: number): Promise<SessionCredentialDto>;
  /** 撤销平台侧已到期的凭据，返回撤销数量。 */
  revokeExpiredCredentials(): Promise<number>;
  /** 发布流程：把开发容器工作目录里的分支以平台身份推到远端。 */
  pushBranch(serviceId: ServiceId, workdir: string, branch: string): Promise<{ commitSha: string }>;
}

export interface ScmRepositoryWriteHistory {
  readonly revision: string; readonly metadataComplete: boolean;
  readonly bindings: readonly { serviceId: ServiceId; remoteProjectId: string; pathWithNamespace: string; bindingCreatedAt: string }[];
  readonly credentials: readonly { id: string; serviceId: ServiceId; remoteTokenId: string }[];
  readonly origins: readonly { serviceId: ServiceId; remoteProjectId: string; pathWithNamespace: string; createdAt: string | null; source: 'legacy-binding' | 'callback-result' }[];
  readonly records: readonly {
    readonly id: string; readonly serviceId: ServiceId; readonly kind: string; readonly state: 'running' | 'exited'; readonly remoteProjectId: string | null;
    readonly backendPid: number; readonly callbackPid: number; readonly callbackStartedAt: string;
    readonly process: { readonly podUid: string; readonly containerId: string; readonly nodeUid: string; readonly nodeName: string } | null;
    readonly result: 'succeeded' | 'failed' | 'interrupted' | null; readonly exitDigest: string | null;
    readonly effects: readonly { readonly intentId: string; readonly kind: 'repository' | 'credential'; readonly stage: 'intent' | 'returned';
      readonly remoteProjectId?: string; readonly remoteTokenId?: string; readonly path?: string; readonly credentialId?: string; readonly createdAt?: string; readonly userId?: string }[];
  }[];
  readonly identities: readonly { kind: 'service' | 'credential'; id: string; serviceId: string }[];
  readonly unresolvedEffects: readonly { workId: string; intentId: string }[];
  readonly unownedCredentialIds: readonly string[];
}
