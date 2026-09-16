import type {
  ProjectPage, ProjectPageEntry, ProjectPageQuery,
  ComputeProfileAdminDto, ComputeProfileDto, ComputeProfileSummaryDto, ComputeProfileWriteRequest, Actor, CreateProjectRequest, ListProjectsQuery, ManifestKind, MemberDto, ProjectDto, ProjectId, ProjectState, QuotaDto, ServiceDto,
  ServiceId, ServicePlanDto, SetMemberRequest, SetQuotaRequest, TaskProfileDto, UserId,
  AppVisibilityDto, AppVisibilityCheckDto, SetAppVisibilityRequest, AppPresentationDto, SetAppPresentationRequest, MemberCandidateDto, MarketAppsQuery, MarketAppDto,
} from '@crewstation/contracts';

export type ProjectAction =
  | 'view' | 'develop' | 'publish' | 'switch-traffic' | 'manage-members' | 'manage-testers'
  | 'approve-data-access' | 'manage-production-config' | 'manage-development-config'
  | 'force-release-session' | 'view-preview' | 'manage-alerts' | 'manage-quota' | 'archive';

export type EffectiveRole = 'admin' | 'owner' | 'developer' | 'tester';

export interface ResolvedService {
  projectId: ProjectId;
  serviceId: ServiceId;
  slug: string;
  name: string;
  identity: string;
  namespace: string;
  kind: ManifestKind;
  /** 所属项目的状态；开通链据此判断是重跑还是首次开通。 */
  state: ProjectState;
}

/** 控制面开通的输入事实；初始选择与当前仓库／生产部署配置不是同一件事。 */
export interface ProvisioningProject {
  projectId: ProjectId;
  serviceId: ServiceId;
  slug: string;
  name: string;
  namespace: string;
  kind: ManifestKind;
  state: ProjectState;
  template: string;
  initialPlan?: string;
}

/** 供 L6 聚合正式状态；serviceId 仅供模块间定位，HTTP 市场响应显式投影。 */
export type MarketListing = Omit<MarketAppDto, 'production'> & { serviceId?: ServiceId };

/** project 模块对外能力；其他模块经 ports 注入其中的子集。 */
export interface ProjectModuleApi {
  readonly name: 'project';
  isAdmin(userId: UserId): Promise<boolean>;
  roleOf(actor: Actor, projectId: ProjectId): Promise<EffectiveRole | undefined>;
  /** 无权限时抛 forbidden；非成员抛 not_found。 */
  authorize(actor: Actor, projectId: ProjectId, action: ProjectAction): Promise<EffectiveRole>;
  createProject(actor: Actor, input: CreateProjectRequest): Promise<ProjectDto>;
  getProject(actor: Actor, projectId: ProjectId): Promise<ProjectDto>;
  listProjects(actor: Actor, query?: ListProjectsQuery): Promise<ProjectDto[]>;
  /** 身份组合根读取当前账号的完整成员关系，避免逐项目加载服务和角色。 */
  listUserMemberships(userId: UserId): Promise<Array<{ projectId: ProjectId; role: MemberDto['role'] }>>;
  listProjectPage(actor: Actor, query: ProjectPageQuery): Promise<ProjectPage>;
  readProjectPageEntries(actor: Actor, ids: readonly ProjectId[]): Promise<ProjectPageEntry[]>;
  /** 当前页关联对象的基础资料；最多 50 个 ID，只读本模块一次联查，不逐项查负责人。 */
  readProjectBasics(actor: Actor, ids: readonly ProjectId[]): Promise<ProjectDto[]>;
  getProjectPageEntry(actor: Actor, projectId: ProjectId): Promise<ProjectPageEntry>;
  listMarketListings(actor: Actor, query: MarketAppsQuery): Promise<{ items: MarketListing[]; nextCursor?: string }>;
  getMarketListing(actor: Actor, projectId: ProjectId): Promise<MarketListing>;
  getAppVisibility(actor: Actor, projectId: ProjectId): Promise<AppVisibilityDto>;
  setAppVisibility(actor: Actor, projectId: ProjectId, input: SetAppVisibilityRequest): Promise<AppVisibilityDto>;
  checkAppVisibility(actor: Actor, projectId: ProjectId, userId: UserId): Promise<AppVisibilityCheckDto>;
  getAppPresentation(actor: Actor, projectId: ProjectId): Promise<AppPresentationDto>;
  setAppPresentation(actor: Actor, projectId: ProjectId, input: SetAppPresentationRequest): Promise<AppPresentationDto>;
  memberCandidates(actor: Actor, projectId: ProjectId, identity: string): Promise<MemberCandidateDto[]>;
  archiveProject(actor: Actor, projectId: ProjectId): Promise<ProjectDto>;
  setProjectState(projectId: ProjectId, state: ProjectState, message?: string): Promise<ProjectDto>;
  getService(actor: Actor, serviceId: ServiceId): Promise<ServiceDto>;
  resolveServiceIdentity(identity: string): Promise<ResolvedService | undefined>;
  /** 无 actor 的内部解析，供网关、发布、任务等模块经端口使用。 */
  resolveServiceById(serviceId: ServiceId): Promise<ResolvedService | undefined>;
  resolveServiceOfProject(projectId: ProjectId): Promise<ResolvedService | undefined>;
  listServices(): Promise<ResolvedService[]>;
  /** 单项目内部查询，不遍历所有项目；缺失或已归档时不再开通。 */
  getProvisioningProject(projectId: ProjectId): Promise<ProvisioningProject | undefined>;
  ownerOf(projectId: ProjectId): Promise<UserId | undefined>;
  listMembers(actor: Actor, projectId: ProjectId): Promise<MemberDto[]>;
  setMember(actor: Actor, projectId: ProjectId, input: SetMemberRequest): Promise<MemberDto>;
  removeMember(actor: Actor, projectId: ProjectId, userId: UserId): Promise<void>;
  getQuota(actor: Actor, projectId: ProjectId): Promise<QuotaDto>;
  setQuota(actor: Actor, projectId: ProjectId, input: SetQuotaRequest): Promise<QuotaDto>;
  quotaLimit(projectId: ProjectId): Promise<number | undefined>;
  listServicePlans(): Promise<ServicePlanDto[]>;
  upsertServicePlan(actor: Actor, plan: ServicePlanDto): Promise<ServicePlanDto>;
  listTaskProfiles(): Promise<TaskProfileDto[]>;
  /** 租户面：名字、说明与能否起 Agent（RFC-001、RFC-004）。 */
  listComputeProfiles(): Promise<ComputeProfileSummaryDto[]>;
  /** 管理面：含驱动、模型与运行环境就绪信息；非管理员抛 forbidden。 */
  listComputeProfilesFull(actor: Actor): Promise<ComputeProfileAdminDto[]>;
  /** 按 expectedRevision 比较后写入；已托管档位缺少期望版本时 precondition，版本不符 conflict。 */
  upsertComputeProfile(actor: Actor, input: ComputeProfileWriteRequest): Promise<ComputeProfileDto>;
  deleteComputeProfile(actor: Actor, name: string): Promise<void>;
  /** 档位名 → 具体驱动、模型与运行环境绑定；不存在返回 undefined，由调用方决定报错文案。 */
  resolveComputeProfile(name: string): Promise<ComputeProfileDto | undefined>;
  /** 引用某运行环境的档位名（RFC-004）。 */
  listComputeProfilesReferencing(runtimeConfigId: string): Promise<string[]>;
  upsertTaskProfile(actor: Actor, profile: TaskProfileDto): Promise<TaskProfileDto>;
}
