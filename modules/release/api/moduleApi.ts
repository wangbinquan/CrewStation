import type { ClusterResource, ClusterInspectRequest, ClusterInspection, ClusterOperation } from '@crewstation/contracts';
import type { Actor, AutoOfflinePolicyDto, PostponeOfflineRequest, PublishRequest, RedeployPrecheckDto, RedeployRequest, ReleaseDto, ReleaseId, ServiceId, SetAutoOfflinePolicyRequest, SlotDto, SlotEventDto, TakeOfflineRequest, TrafficSwitchDto, TrafficSwitchRequest } from '@crewstation/contracts';

export type PhysicalSlot = 'blue' | 'green';

/** 调和器要建的是哪个槽的哪一次部署（RFC-025 T8，槽记录期望里的）。 */
export interface SlotDeployRef {
  readonly recordId: string;
  readonly serviceId: string;
  readonly physical: PhysicalSlot;
  readonly releaseId: string;
  readonly revision: number;
}

export interface ActiveEndpoint {
  physical: PhysicalSlot;
  namespace: string;
  kubernetesService: string;
  port: number;
}

/** release 模块对外能力：发布、切流、查询；流水线推进由工作器调用。 */
export interface ReleaseModuleApi {
  readonly name: 'release';
  listClusterSlots(): Promise<Array<{ serviceId: string; physical: PhysicalSlot; role: 'prod' | 'preview'; releaseId?: string; state: string; manifestReplicas?: number; overrideReplicas?: number; plan?: string; revision: string }>>;
  inspectSlotOperation(actor: Actor, target: ClusterResource, request: ClusterInspectRequest): Promise<Pick<ClusterInspection, 'capability' | 'domain'>>;
  executeSlotOperation(actor: Actor, operation: ClusterOperation, inspection: ClusterInspection): Promise<{ operationId: string }>;
  observeSlotOperation(operation: ClusterOperation): Promise<{ done: boolean; failed?: boolean; reason: string }>;
  publish(actor: Actor, serviceId: ServiceId, input: PublishRequest): Promise<ReleaseDto>;
  switchTraffic(actor: Actor, serviceId: ServiceId, input: TrafficSwitchRequest): Promise<TrafficSwitchDto>;
  listReleases(actor: Actor, serviceId: ServiceId): Promise<ReleaseDto[]>;
  getRelease(actor: Actor, releaseId: ReleaseId): Promise<ReleaseDto>;
  getSlots(actor: Actor, serviceId: ServiceId): Promise<SlotDto[]>;
  /** 既有测试角色的只读试用入口；不授予项目 view。 */
  getPreviewSlot(actor: Actor, serviceId: ServiceId): Promise<SlotDto | null>;
  listTrafficSwitches(actor: Actor, serviceId: ServiceId): Promise<TrafficSwitchDto[]>;
  activeEndpoint(serviceId: ServiceId): Promise<ActiveEndpoint | undefined>;
  slotRoles(serviceId: ServiceId): Promise<{ prod: PhysicalSlot; preview: PhysicalSlot } | undefined>;
  /** 两个槽当前版本的 Manifest 按名称引用的算力档位（RFC-006 P8）。 */
  deployedComputeReferences(serviceId: ServiceId): Promise<string[]>;
  /** 推进一步流水线；返回是否结束与建议的重试间隔。 */
  runPipelineStep(releaseId: ReleaseId): Promise<{ done: boolean; retryAfterSeconds: number }>;

  // —— RFC-021：待命槽的下线、推迟、重新部署与自动下线 ——
  /** 负责人与管理员下线待验证版本；返回两个槽。 */
  takeOffline(actor: Actor, serviceId: ServiceId, input: TakeOfflineRequest): Promise<SlotDto[]>;
  /** 把自动下线推迟一个周期；返回两个槽。 */
  postponeOffline(actor: Actor, serviceId: ServiceId, input: PostponeOfflineRequest): Promise<SlotDto[]>;
  /** 从发布记录重新部署到待命槽，不构建、不迁移。 */
  redeploy(actor: Actor, releaseId: ReleaseId, input: RedeployRequest): Promise<ReleaseDto>;
  /** 重新部署的统一预检（只读）：不通过时给标准原因，确认时同样的原因以 412 返回。 */
  redeployPrecheck(actor: Actor, releaseId: ReleaseId): Promise<RedeployPrecheckDto>;
  listSlotEvents(actor: Actor, serviceId: ServiceId): Promise<SlotEventDto[]>;
  /** 自动下线巡检（cs-controller 定时调用）。 */
  sweepSlotLifecycle(): Promise<{ initialized: number; reminded: number; offline: number; repaired: number }>;
  /** 供 gateway：放行 preview 请求后记一次访问（进程内节流）。 */
  notePreviewAccess(serviceId: ServiceId): Promise<void>;
  getAutoOfflinePolicy(actor: Actor): Promise<AutoOfflinePolicyDto>;
  setAutoOfflinePolicy(actor: Actor, input: SetAutoOfflinePolicyRequest): Promise<AutoOfflinePolicyDto>;

  // —— RFC-025 T8：服务槽由资源中心建出，调和器回头要环境、报建不成 ——
  /** 建这一次部署的环境 Secret 之前要内容（平台约定变量、生产组配置与数据连接串）；槽上已不是这一次部署时拒绝。 */
  slotEnvValues(ref: SlotDeployRef): Promise<Readonly<Record<string, string>>>;
  /** 这一次部署建不成：槽记为失败并记下原因，流水线下一步据此判发布失败；已不是这一次部署时忽略。 */
  slotFailed(ref: SlotDeployRef, message: string): Promise<void>;
}
