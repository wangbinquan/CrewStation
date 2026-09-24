import type {
  ProjectServicePolicyDto, SaveProjectServicePolicy,
  CreateServicePlan, CreateTaskProfile,  ProjectCreationCatalog, ProjectPage, ProjectPageEntry, ProjectPageQuery,
  Actor, CreateProjectRequest, ListProjectsQuery, ManifestKind, MemberDto, ProjectDto, ProjectId, ProjectState, QuotaDto, ServiceDto,
  ServiceId, ServicePlanDto, ServicePlanWrite, TaskProfileWrite, SetMemberRequest, SetQuotaRequest, TaskProfileDto, UserId,
  AppVisibilityDto, SetAppVisibilityRequest, AppPresentationDto, SetAppPresentationRequest, MemberCandidateDto, MarketAppsQuery, MarketAppDto,
  AppAccessRequestDto, AppAccessRequestPage, AppAccessStatusDto, CreateAppAccessRequest, DecideAppAccessRequest, RequestPageQuery,
} from '@crewstation/contracts';

export type ProjectAction =
  | 'view' | 'develop' | 'publish' | 'switch-traffic' | 'manage-members' | 'manage-testers'
  | 'approve-data-access' | 'manage-production-config' | 'manage-development-config'
  | 'force-release-session' | 'view-preview' | 'manage-quota' | 'archive'
  // RFC-021：下线／推迟／重新部署待验证版本、开关正式版本维护（负责人与管理员）。
  | 'manage-slots' | 'manage-maintenance';

export type EffectiveRole = 'admin' | 'owner' | 'developer' | 'tester' | 'user';

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

/**
 * 正式地址放不放这个人（2026-09-24 裁定，网关的 ForwardAuth 每个请求都问）：`denied` 带无权限页要写的事实；
 * `unknown` 是查不到项目或已归档。identity 的 AppAccess 端口与它同形，由组合根转接。
 */
export type AppAccessVerdict =
  | { readonly kind: 'allowed' }
  | { readonly kind: 'denied'; readonly projectId: ProjectId; readonly appName: string; readonly ownerName: string; readonly requestable: boolean }
  | { readonly kind: 'unknown' };

/** 供 L6 聚合正式状态；serviceId 仅供模块间定位，HTTP 市场响应显式投影。 */
export type MarketListing = Omit<MarketAppDto, 'production' | 'entry'> & { serviceId?: ServiceId };

/** project 模块对外能力；其他模块经 ports 注入其中的子集。 */
export interface ProjectModuleApi {
  readonly name: 'project';
  isAdmin(userId: UserId): Promise<boolean>;
  roleOf(actor: Actor, projectId: ProjectId): Promise<EffectiveRole | undefined>;
  /** 无权限时抛 forbidden；非成员抛 not_found。 */
  authorize(actor: Actor, projectId: ProjectId, action: ProjectAction): Promise<EffectiveRole>;
  creationCatalog(actor: Actor): Promise<ProjectCreationCatalog>;
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
  getAppPresentation(actor: Actor, projectId: ProjectId): Promise<AppPresentationDto>;
  setAppPresentation(actor: Actor, projectId: ProjectId, input: SetAppPresentationRequest): Promise<AppPresentationDto>;
  memberCandidates(actor: Actor, projectId: ProjectId, identity: string): Promise<MemberCandidateDto[]>;
  /** 无 actor 的受信路径：只给网关判定正式地址用，`user` 是会话里刚读出的账号。 */
  appAccessBySlug(user: { readonly id: UserId; readonly isAdmin: boolean }, projectSlug: string): Promise<AppAccessVerdict>;
  /** 申请页：任何登录用户都能读自己对某应用的使用权与最近一条申请。 */
  getAppAccessStatus(actor: Actor, projectId: ProjectId): Promise<AppAccessStatusDto>;
  requestAppAccess(actor: Actor, projectId: ProjectId, input: CreateAppAccessRequest): Promise<AppAccessRequestDto>;
  /** 带 projectId 时负责人与管理员可读；不带时只给管理员（管理空间「申请审批」）。 */
  listAppAccessRequests(actor: Actor, query: RequestPageQuery): Promise<AppAccessRequestPage>;
  /** 批准即加为「用户」角色成员（已是成员的保留原角色）。 */
  decideAppAccessRequest(actor: Actor, requestId: string, input: DecideAppAccessRequest): Promise<AppAccessRequestDto>;
  archiveProject(actor: Actor, projectId: ProjectId): Promise<ProjectDto>;
  setProjectState(projectId: ProjectId, state: ProjectState, message?: string): Promise<ProjectDto>;
  getService(actor: Actor, serviceId: ServiceId): Promise<ServiceDto>;
  resolveServiceIdentity(identity: string): Promise<ResolvedService | undefined>;
  /** 无 actor 的内部解析，供网关、发布、任务等模块经端口使用。 */
  resolveServiceById(serviceId: ServiceId): Promise<ResolvedService | undefined>;
  resolveServiceOfProject(projectId: ProjectId): Promise<ResolvedService | undefined>;
  listClusterProjects(): Promise<Array<{ projectId: string; name: string; slug: string; namespace: string; kind: string; state: string; serviceId?: string; serviceName?: string }>>;
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
  getServicePolicy(actor: Actor, projectId: ProjectId): Promise<ProjectServicePolicyDto>;
  listProjectServicePlans(actor: Actor, projectId: ProjectId): Promise<ServicePlanDto[]>;
  saveServicePolicy(actor: Actor, projectId: ProjectId, input: SaveProjectServicePolicy): Promise<ProjectServicePolicyDto>;
  resolveProjectServicePlan(projectId: ProjectId, planId: string): Promise<ServicePlanDto | undefined>;
  listServicePlans(): Promise<ServicePlanDto[]>;
  createServicePlan(actor: Actor, plan: CreateServicePlan): Promise<ServicePlanDto>;
  updateServicePlan(actor: Actor, id: string, plan: ServicePlanWrite): Promise<ServicePlanDto>;
  updateTaskProfile(actor: Actor, id: string, profile: TaskProfileWrite): Promise<TaskProfileDto>;
  listTaskProfiles(): Promise<TaskProfileDto[]>;
  createTaskProfile(actor: Actor, profile: CreateTaskProfile): Promise<TaskProfileDto>;
}
