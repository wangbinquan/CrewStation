import type {
  Actor, DeliveryDto, DeliveryState, EventTypeDto, LegacyProducedEvent, ProducedEvent, ProduceResultDto, ProjectId, ServiceActor, ServiceId, SubscriptionDto, UserId,
} from '@crewstation/contracts';

/** 调用链的时间键：firstAt 为毫秒精度的开始时间；before 取上一页最后一条的 (firstAt, traceId)。 */
export interface TraceKeyDto { traceId: string; firstAt: string; lastAt: string; active: boolean }
export interface TraceKeyPage { before?: { at: string; traceId: string }; limit: number }
/** 调用链回放用的投递：比 DeliveryDto 多创建与最后变化的时间。 */
export type TraceDeliveryDto = DeliveryDto & { createdAt: string; updatedAt: string };

export interface DeliveryFilter {
  readonly state?: DeliveryState;
  /** 缺省 50。 */
  readonly limit?: number;
}

/** 一次投递尝试的结果；worker 据此决定是否让队列按退避重排。 */
export interface DeliverOutcome {
  readonly state: DeliveryState;
  readonly error?: string;
}

/** events 模块对外能力（cs-events 的 ingress 与投递，cs-api 的查询）；其他模块经 ports 注入其中的子集。 */
export interface EventsModuleApi {
  readonly name: 'events';
  isAdmin(userId: UserId): Promise<boolean>;
  /** EventProducer 经服务域投递原始事件：校验调用方是该事件类型的登记生产方，inbox 按 (producer, dedupKey) 去重，为每个活动订阅建投递并入队。 */
  produceLegacy(caller: ServiceActor, input: LegacyProducedEvent): Promise<ProduceResultDto>;
  produce(caller: ServiceActor, input: ProducedEvent): Promise<ProduceResultDto>;
  listEventTypes(actor: Actor): Promise<EventTypeDto[]>;
  listSubscriptions(actor: Actor, projectId: ProjectId): Promise<SubscriptionDto[]>;
  listDeliveries(actor: Actor, projectId: ProjectId, filter?: DeliveryFilter): Promise<DeliveryDto[]>;
  /** 负责人把死信重新入队，从第一次尝试重新计数。 */
  replayDelivery(actor: Actor, deliveryId: string): Promise<DeliveryDto>;
  /** 内部：由投递 worker 调用，执行一次推送并推进投递状态机。 */
  deliver(deliveryId: string): Promise<DeliverOutcome>;
  /** 补发维护暂存的投递（RFC-021）：给了服务只补它的；返回补发条数。 */
  releaseHeld(serviceId?: ServiceId): Promise<number>;
  /** 调用链列表（Design §14）的内部读取，调用方已校验项目可见：本项目投递按 traceId 分组的时间键，按开始时间倒序翻页。 */
  traceKeys(projectId: ProjectId, page: TraceKeyPage): Promise<TraceKeyDto[]>;
  /** since（ISO 时间）之后有变化、或仍在投递中的链。 */
  activeTraceIds(projectId: ProjectId, since: string): Promise<string[]>;
  /** 这些链在本项目里的投递；同一事件投给别的项目的那几条不在内。 */
  listTraceDeliveries(projectId: ProjectId, traceIds: readonly string[]): Promise<TraceDeliveryDto[]>;
}
