import type {
  Actor, DeliveryDto, DeliveryState, EventTypeDto, LegacyProducedEvent, ProducedEvent, ProduceResultDto, ProjectId, ServiceActor, ServiceId, SubscriptionDto, UserId,
} from '@crewstation/contracts';

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
}
