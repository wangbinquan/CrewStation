import type {
  Actor, CreateProjectRequest, ManifestKind, MemberDto, ProjectDto, ProjectId, ProjectState, QuotaDto, ServiceDto,
  ServiceId, ServicePlanDto, SetMemberRequest, SetQuotaRequest, TaskProfileDto, UserId,
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
  namespace: string;
  kind: ManifestKind;
}

/** project 模块对外能力；其他模块经 ports 注入其中的子集。 */
export interface ProjectModuleApi {
  readonly name: 'project';
  isAdmin(userId: UserId): Promise<boolean>;
  roleOf(actor: Actor, projectId: ProjectId): Promise<EffectiveRole | undefined>;
  /** 无权限时抛 forbidden；非成员抛 not_found。 */
  authorize(actor: Actor, projectId: ProjectId, action: ProjectAction): Promise<EffectiveRole>;
  createProject(actor: Actor, input: CreateProjectRequest): Promise<ProjectDto>;
  getProject(actor: Actor, projectId: ProjectId): Promise<ProjectDto>;
  listProjects(actor: Actor): Promise<ProjectDto[]>;
  archiveProject(actor: Actor, projectId: ProjectId): Promise<ProjectDto>;
  setProjectState(projectId: ProjectId, state: ProjectState, message?: string): Promise<ProjectDto>;
  getService(actor: Actor, serviceId: ServiceId): Promise<ServiceDto>;
  resolveServiceIdentity(identity: string): Promise<ResolvedService | undefined>;
  listMembers(actor: Actor, projectId: ProjectId): Promise<MemberDto[]>;
  setMember(actor: Actor, projectId: ProjectId, input: SetMemberRequest): Promise<MemberDto>;
  removeMember(actor: Actor, projectId: ProjectId, userId: UserId): Promise<void>;
  getQuota(actor: Actor, projectId: ProjectId): Promise<QuotaDto>;
  setQuota(actor: Actor, projectId: ProjectId, input: SetQuotaRequest): Promise<QuotaDto>;
  quotaLimit(projectId: ProjectId): Promise<number | undefined>;
  listServicePlans(): Promise<ServicePlanDto[]>;
  upsertServicePlan(actor: Actor, plan: ServicePlanDto): Promise<ServicePlanDto>;
  listTaskProfiles(): Promise<TaskProfileDto[]>;
  upsertTaskProfile(actor: Actor, profile: TaskProfileDto): Promise<TaskProfileDto>;
}
