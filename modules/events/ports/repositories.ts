import type { DeliveryState, EventId, ProjectId, ServiceId } from '@crewstation/contracts';
import type { Delivery } from '../domain/delivery';
import type { InboxEvent } from '../domain/inboxEvent';
import type { EventType, Producer } from '../domain/producer';
import type { Subscription } from '../domain/subscription';

export interface ProducerRepository {
  upsert(producer: Producer): Promise<void>;
  getByName(producer: string): Promise<Producer | undefined>;
}

export interface EventTypeRepository {
  getByEventType(eventType: string): Promise<EventType | undefined>;
  list(): Promise<EventType[]>;
  /** 用新声明整体替换该生产方的事件类型。 */
  replaceForProducer(producer: string, types: readonly EventType[]): Promise<void>;
}

export interface SubscriptionRepository {
  getById(id: string): Promise<Subscription | undefined>;
  listByService(serviceId: ServiceId): Promise<Subscription[]>;
  listByProject(projectId: ProjectId): Promise<Subscription[]>;
  listActiveByEventType(eventType: string): Promise<Subscription[]>;
  upsert(subscription: Subscription): Promise<void>;
  remove(id: string): Promise<void>;
}

export interface InboxRepository {
  /** (producer, dedupKey) 已存在时不写入并返回 false。 */
  insert(event: InboxEvent): Promise<boolean>;
  getById(id: EventId): Promise<InboxEvent | undefined>;
  getByDedup(producer: string, dedupKey: string): Promise<InboxEvent | undefined>;
}

export interface DeliveryRepository {
  insert(delivery: Delivery): Promise<void>;
  update(delivery: Delivery): Promise<void>;
  getById(id: string): Promise<Delivery | undefined>;
  /** 按创建时间倒序。 */
  listByProject(projectId: ProjectId, state: DeliveryState | undefined, limit: number): Promise<Delivery[]>;
}
