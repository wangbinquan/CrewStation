import type { DeliveryState, EventId, ProjectId, ServiceId } from '@crewstation/contracts';
import type { Delivery } from '../domain/delivery';
import type { InboxEvent } from '../domain/inboxEvent';
import type { EventType, Producer } from '../domain/producer';
import type { Subscription } from '../domain/subscription';

export interface ProducerRepository {
  upsert(producer: Producer): Promise<void>;
  getById(id: string): Promise<Producer | undefined>;
  getByService(serviceId: ServiceId): Promise<Producer | undefined>;
  getByCode(producer: string): Promise<Producer | undefined>;
}

export interface EventTypeRepository {
  getById(id: string): Promise<EventType | undefined>;
  getByCode(eventType: string): Promise<EventType | undefined>;
  list(): Promise<EventType[]>;
  /** 用新声明整体替换该生产方的事件类型。 */
  replaceForProducer(producerId: string, types: readonly EventType[]): Promise<void>;
}

export interface SubscriptionRepository {
  getById(id: string): Promise<Subscription | undefined>;
  listByService(serviceId: ServiceId): Promise<Subscription[]>;
  listByProject(projectId: ProjectId): Promise<Subscription[]>;
  listActiveByEventType(eventTypeId: string): Promise<Subscription[]>;
  upsert(subscription: Subscription): Promise<void>;
  remove(id: string): Promise<void>;
}

export interface InboxRepository {
  /** (producer, dedupKey) 已存在时不写入并返回 false。 */
  insert(event: InboxEvent): Promise<boolean>;
  getById(id: EventId): Promise<InboxEvent | undefined>;
  getByDedup(producerId: string, dedupKey: string): Promise<InboxEvent | undefined>;
}

export interface DeliveryRepository {
  insert(delivery: Delivery): Promise<void>;
  update(delivery: Delivery): Promise<void>;
  /** uow.run 内按行锁定至事务结束；uow.read 为普通快照读取。 */
  getById(id: string): Promise<Delivery | undefined>;
  /** 按创建时间倒序。 */
  listByProject(projectId: ProjectId, state: DeliveryState | undefined, limit: number): Promise<Delivery[]>;
  /** 维护暂存的投递（RFC-021）：给了服务只列它的，按创建时间（事件接收顺序）正序。 */
  listHeld(serviceId: ServiceId | undefined, limit: number): Promise<Delivery[]>;
  /** 调用链列表（Design §14）：本项目的投递按 traceId 分组的时间键，按开始时间倒序翻页。 */
  traceKeys(projectId: ProjectId, page: DeliveryTracePage): Promise<DeliveryTraceKey[]>;
  /** since 之后有变化、或仍在投递中（含维护暂存）的链。 */
  activeTraceIds(projectId: ProjectId, since: string): Promise<string[]>;
  /** 这些链在本项目里的投递，按创建时间正序；同一事件投给别的项目的那几条不在内。 */
  listByProjectTraces(projectId: ProjectId, traceIds: readonly string[]): Promise<Delivery[]>;
}

/** 时间键：firstAt 为毫秒精度的开始时间，before 取上一页最后一条的 (firstAt, traceId)。 */
export interface DeliveryTraceKey { traceId: string; firstAt: string; lastAt: string; active: boolean }
export interface DeliveryTracePage { before?: { at: string; traceId: string }; limit: number }
