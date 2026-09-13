import type {
  ComputeProfileDto, ComputeProfileSummaryDto, Actor, CreateProjectRequest, ListProjectsQuery, ManifestKind, MemberDto, ProjectDto, ProjectId, ProjectState, QuotaDto, ServiceDto,
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
  listServices(): Promise<ResolvedService[]>;
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
  /** 租户面：只有名字与说明（RFC-001）。 */
  listComputeProfiles(): Promise<ComputeProfileSummaryDto[]>;
  /** 管理面：含驱动与模型；非管理员抛 forbidden。 */
  listComputeProfilesFull(actor: Actor): Promise<ComputeProfileDto[]>;
  upsertComputeProfile(actor: Actor, profile: ComputeProfileDto): Promise<ComputeProfileDto>;
  deleteComputeProfile(actor: Actor, name: string): Promise<void>;
  /** 档位名 → 具体驱动与模型；不存在返回 undefined，由调用方决定报错文案。 */
  resolveComputeProfile(name: string): Promise<ComputeProfileDto | undefined>;
  upsertTaskProfile(actor: Actor, profile: TaskProfileDto): Promise<TaskProfileDto>;
}
