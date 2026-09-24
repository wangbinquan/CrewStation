import type { Actor, AllowlistDocument, ExitMaintenanceRequest, MaintenanceDto, OfflineReason, ProjectId, ProjectRateLimitsDto, RateLimits, RateLimitSettingsDto, RouteEntry, ServiceId, ServiceMaintenanceView, SetMaintenanceRequest, SetProjectRateLimitsRequest, SetRateLimitSettingsRequest, UserId, WorkloadIdentity } from '@crewstation/contracts';

export interface EvaluationTarget { host: string; method: string; path: string }
/** `unavailable`：目标正式版本维护中（RFC-021），ForwardAuth 回 503 而不是 403。 */
export interface Evaluation { allowed: boolean; targetIdentity: string; reason?: string; unavailable?: { message: string; retryAfterSeconds?: number } }

/**
 * 用户域入口（prod／preview 主机）在放行前的判定（RFC-021 design §6）：只剩正式版本维护。待命槽上没有版本不再由 ForwardAuth 判——
 * 槽「已结束」时路由改指说明页（RFC-025 D13、I26 裁定）。
 */
export type EntryVerdict =
  | { readonly kind: 'open' }
  | { readonly kind: 'maintenance'; readonly projectSlug: string; readonly reason: string; readonly expectedEndAt?: string; readonly retryAfterSeconds?: number };

/**
 * 说明页的内容（RFC-025 设计 §7.2，D13）：待验证或正式主机此刻没有在运行的版本——何时因何下线，或尚未部署、尚未上线；
 * 路由还没改回来的那一瞬（刚部署好）是 recovering。错误体沿用 RFC-021 的 `not-deployed`＋`details`（I26 裁定）。
 */
export interface NotDeployedEntry {
  readonly kind: 'not-deployed';
  readonly projectSlug: string;
  readonly slot: 'prod' | 'preview';
  readonly recovering?: true;
  readonly offline?: { readonly at: string; readonly reason: OfflineReason; readonly tag?: string };
}

/** 说明页在 cs-api 上的路径前缀，后面接路由记录 ID；调和器渲染的 replacePath 中间件把请求换到这里。 */
export const UNAVAILABLE_PATH = '/_crewstation/unavailable';

/** 维护中的服务（供市场卡片）：开关、原因、预计恢复时间与临时指定的人。 */
export interface MaintenanceSnapshot { switches: { users: boolean; services: boolean; events: boolean }; allowUserIds: readonly UserId[]; reason: string; expectedEndAt?: Date }

/** 观测到的 Pod（cluster-control 的观测缓存转交，结构上是 Kubernetes 对象的子集）。 */
export interface ObservedPodObject {
  readonly metadata: { readonly name: string; readonly namespace?: string; readonly labels?: Readonly<Record<string, string>> };
  readonly status?: unknown;
}

/** gateway 模块对外能力：路由与放行表生成、Pod 身份反查与服务域放行评估（cs-auth 用后两者）。 */
export interface GatewayModuleApi {
  readonly name: 'gateway';
  reconcileService(serviceId: ServiceId): Promise<RouteEntry[]>;
  reconcileAll(): Promise<number>;
  /** 路由的台账补投影（RFC-025）：按网关存的路由表逐个服务再投影一次，不重新 apply；返回处理的服务数。 */
  resyncRouteLedger(): Promise<number>;
  removeService(serviceId: ServiceId): Promise<void>;
  listRoutes(): Promise<Array<{ serviceId: string; serviceName: string; routes: RouteEntry[] }>>;
  rebuildAllowlist(): Promise<AllowlistDocument>;
  currentAllowlist(): Promise<AllowlistDocument | undefined>;
  /**
   * 放行表定时全量核对（RFC-025 设计 §7.4）：与按当前授权推导的内容不一致就重算一版；配了资源台账时结果写进各服务的服务域路由记录
   * （条件 AllowlistDrift）。返回有出入的调用方、是否影响全体，与核对之后的版本。cs-controller 每 10 分钟跑一次。
   */
  checkAllowlist(): Promise<{ readonly callers: readonly string[]; readonly global: boolean; readonly version: number }>;
  evaluate(caller: WorkloadIdentity, target: EvaluationTarget): Promise<Evaluation>;
  lookupByIp(ip: string): Promise<WorkloadIdentity | undefined>;
  /** 身份索引的墓碑清理（RFC-025 提案 Q5）：标为删除超过 7 天的行删掉；返回条数。cs-controller 每小时跑一次。 */
  purgeIdentityTombstones(): Promise<number>;
  /** 身份索引（RFC-025 设计 §7.4）：cluster-control 观测到的 Pod 变化，全平台只剩这一条 Pod watch。gone 是对象已消失。 */
  syncObservedPod(pod: ObservedPodObject, gone: boolean): Promise<void>;
  /** 观测缓存全量同步之后：这一份是全部受管 Pod，逐个同步并把这次没列到的在册行标为删除；返回标掉的条数。 */
  relistObservedPods(pods: readonly ObservedPodObject[]): Promise<number>;

  // —— RFC-021：正式版本维护 ——
  getMaintenance(actor: Actor, serviceId: ServiceId): Promise<ServiceMaintenanceView>;
  setMaintenance(actor: Actor, serviceId: ServiceId, input: SetMaintenanceRequest): Promise<MaintenanceDto>;
  exitMaintenance(actor: Actor, serviceId: ServiceId, input: ExitMaintenanceRequest): Promise<ServiceMaintenanceView>;
  /** cs-auth 用户域 ForwardAuth：prod 主机的维护放行；preview 主机记一次访问（没有版本改由路由指向说明页，RFC-025 D13）。 */
  userEntry(userId: UserId, projectSlug: string, slot: 'prod' | 'preview'): Promise<EntryVerdict>;
  /** cs-events：订阅方的事件开关是否打开（暂存）。 */
  holdsEvents(serviceId: ServiceId): Promise<boolean>;
  /** release：项目处于维护中且三个开关都拦（破坏性迁移窗口）。 */
  maintenanceWindowOpen(serviceId: ServiceId): Promise<boolean>;
  maintenanceOf(serviceId: ServiceId): Promise<MaintenanceSnapshot | undefined>;

  // —— RFC-025 T10：网关限流策略（平台默认与项目覆盖，仅管理员） ——
  getRateLimits(actor: Actor): Promise<RateLimitSettingsDto>;
  setRateLimits(actor: Actor, input: SetRateLimitSettingsRequest): Promise<RateLimitSettingsDto>;
  getProjectRateLimits(actor: Actor, projectId: ProjectId): Promise<ProjectRateLimitsDto>;
  setProjectRateLimits(actor: Actor, projectId: ProjectId, input: SetProjectRateLimitsRequest): Promise<ProjectRateLimitsDto>;
  /** 项目生效的用户域与服务域（覆盖＋平台默认），渲染网关中间件用。 */
  effectiveRateLimits(projectId: ProjectId): Promise<Pick<RateLimits, 'userDomain' | 'serviceDomain'>>;
  /** 限流策略的台账补投影（平台一条与全部在册项目各一条），返回声明的条数；cs-controller 每 5 分钟跑一次。 */
  resyncRateLimitLedger(): Promise<number>;
}
