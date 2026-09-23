import type { Actor, AllowlistDocument, ExitMaintenanceRequest, MaintenanceDto, OfflineReason, RouteEntry, ServiceId, ServiceMaintenanceView, SetMaintenanceRequest, UserId, WorkloadIdentity } from '@crewstation/contracts';

export interface EvaluationTarget { host: string; method: string; path: string }
/** `unavailable`：目标正式版本维护中（RFC-021），ForwardAuth 回 503 而不是 403。 */
export interface Evaluation { allowed: boolean; targetIdentity: string; reason?: string; unavailable?: { message: string; retryAfterSeconds?: number } }

/** 用户域入口（prod／preview 主机）在放行前的判定（RFC-021 design §6）。 */
export type EntryVerdict =
  | { readonly kind: 'open' }
  | { readonly kind: 'maintenance'; readonly projectSlug: string; readonly reason: string; readonly expectedEndAt?: string; readonly retryAfterSeconds?: number }
  | { readonly kind: 'not-deployed'; readonly projectSlug: string; readonly offline?: { readonly at: string; readonly reason: OfflineReason; readonly tag?: string } };

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
  /** cs-auth 用户域 ForwardAuth：prod 主机的维护放行、preview 主机的未部署页。 */
  userEntry(userId: UserId, projectSlug: string, slot: 'prod' | 'preview'): Promise<EntryVerdict>;
  /** cs-events：订阅方的事件开关是否打开（暂存）。 */
  holdsEvents(serviceId: ServiceId): Promise<boolean>;
  /** release：项目处于维护中且三个开关都拦（破坏性迁移窗口）。 */
  maintenanceWindowOpen(serviceId: ServiceId): Promise<boolean>;
  maintenanceOf(serviceId: ServiceId): Promise<MaintenanceSnapshot | undefined>;
}
