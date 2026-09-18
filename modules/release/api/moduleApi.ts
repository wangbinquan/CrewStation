import type { Actor, PublishRequest, ReleaseDto, ReleaseId, ServiceId, SlotDto, TrafficSwitchDto, TrafficSwitchRequest } from '@crewstation/contracts';

export type PhysicalSlot = 'blue' | 'green';

export interface ActiveEndpoint {
  physical: PhysicalSlot;
  namespace: string;
  kubernetesService: string;
  port: number;
}

/** release 模块对外能力：发布、切流、查询；流水线推进由工作器调用。 */
export interface ReleaseModuleApi {
  readonly name: 'release';
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
}
