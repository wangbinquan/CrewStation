import type {
  Actor, ProjectId, ProjectComputePolicyDto, SaveProjectComputePolicy, AgentProtocol, BeforeStartMaterial, ComputeProfileDetailDto, ComputeProfileList, ComputeProfileSummaryDto, ComputeUsage, CopyComputeProfileRequest, CreateComputeProfileRequest,
  LaunchSpec, ProfileRevisionRef, ProfileTestDto, ProfileTestId, RegistryPushCredential, RuntimeImagesInfo, SaveComputeProfileRequest, StartProfileTestRequest,
} from '@crewstation/contracts';

/** 仓库 ForwardAuth 的裁定：200 放行；401 让 Docker 客户端带上 Basic 凭据重试；403 是凭据有效但越权。 */
export type RegistryVerdict = { readonly status: 200 } | { readonly status: 401 | 403; readonly reason: string };

/** 受理一次启动时解析出的档位：名称（default 已换成真实名称）、固定修订与协议。 */
export interface ResolvedProfile {
  readonly name: string;
  readonly revision: number;
  readonly protocol: AgentProtocol;
  readonly taskProfile?: string;
  /** 按摘要固定的镜像引用。 */
  readonly image: string;
}

/** 下发一次启动的全部材料：只在派发命令时取，含解密凭据，不落库、不进日志、不进事件。 */
export interface ProfileLaunchMaterial extends ResolvedProfile {
  readonly launch: LaunchSpec;
  readonly beforeStart: BeforeStartMaterial;
}

/**
 * agent-runtime 对外能力（RFC-006：算力档位的唯一宿主，ADR-0005）。管理接口全部只对管理员开放；
 * 解析接口供 dev-session／business-task／release／capabilities 经组合根使用，launchMaterial 返回的材料含解密凭据，只能进受控 Runner 命令通道。
 */
export interface AgentRuntimeModuleApi {
  readonly name: 'agent-runtime';
  getProjectComputePolicy(actor: Actor, projectId: ProjectId): Promise<ProjectComputePolicyDto>;
  saveProjectComputePolicy(actor: Actor, projectId: ProjectId, input: SaveProjectComputePolicy): Promise<ProjectComputePolicyDto>;
  projectDevTaskProfile(projectId: ProjectId): Promise<string | undefined>;
  listProjectSummaries(actor: Actor, projectId: ProjectId): Promise<ComputeProfileSummaryDto[]>;
  resolveForProject(projectId: ProjectId, name: string | undefined, usage: ComputeUsage): Promise<ResolvedProfile>;
  lookupForProjectRelease(projectId: ProjectId, name: string): Promise<{ name: string; terminalOnly: boolean } | undefined>;
  setDefaultVisible(actor: Actor, name: string, visible: boolean): Promise<ComputeProfileDetailDto>;
  stopClusterTest(actor: Actor, testId: ProfileTestId): Promise<void>;
  listProfiles(actor: Actor): Promise<ComputeProfileList>;
  createProfile(actor: Actor, input: CreateComputeProfileRequest): Promise<ComputeProfileDetailDto>;
  getProfile(actor: Actor, name: string): Promise<ComputeProfileDetailDto>;
  saveProfile(actor: Actor, name: string, input: SaveComputeProfileRequest): Promise<ComputeProfileDetailDto>;
  copyProfile(actor: Actor, source: string, input: CopyComputeProfileRequest): Promise<ComputeProfileDetailDto>;
  setEnabled(actor: Actor, name: string, enabled: boolean): Promise<ComputeProfileDetailDto>;
  setDefault(actor: Actor, name: string): Promise<ComputeProfileDetailDto>;
  removeProfile(actor: Actor, name: string, confirmReferences: boolean): Promise<void>;
  startTest(actor: Actor, name: string, input: StartProfileTestRequest): Promise<ProfileTestDto>;
  getTest(actor: Actor, name: string, testId: ProfileTestId): Promise<ProfileTestDto>;
  /** 工作器入口：执行一条排队的测试。 */
  runQueuedTest(testId: ProfileTestId, heartbeat: () => Promise<boolean>): Promise<void>;
  /** 镜像页：底座镜像引用与摘要、推送地址、示例 Dockerfile（RFC-006 §7）。 */
  runtimeImages(actor: Actor): Promise<RuntimeImagesInfo>;
  /** 签发有期限的推送凭据；口令只在这次响应里出现（C18）。 */
  issuePushCredential(actor: Actor): Promise<RegistryPushCredential>;
  /** 网关对仓库主机每个请求的裁定（ForwardAuth）。 */
  authorizeRegistryRequest(input: { authorization?: string; method: string; uri: string }): RegistryVerdict;
  /** 租户面投影（无 actor：任何登录用户都能看下拉）。 */
  listSummaries(): Promise<ComputeProfileSummaryDto[]>;
  /** 受理新启动：default 在此解析；不可用、终端档位用错用途都抛可读错误。 */
  resolve(nameOrDefault: string | undefined, usage: ComputeUsage): Promise<ResolvedProfile>;
  /** 按固定修订取派发材料（含解密凭据）。 */
  launchMaterial(ref: ProfileRevisionRef): Promise<ProfileLaunchMaterial>;
  /** 发布校验：只看存在性与协议。 */
  lookupForRelease(nameOrDefault: string): Promise<{ name: string; terminalOnly: boolean } | undefined>;
  listNames(): Promise<string[]>;
}
