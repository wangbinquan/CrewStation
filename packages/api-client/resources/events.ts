import type { DeliveryDto, EventTypeDto, SubscriptionDto } from '@crewstation/contracts';
import type { Transport } from '../httpTransport';
import type { ItemsPage } from '../itemsPage';
import type { ListDeliveriesInput } from '../requestInputs';
import { segment } from '../requestUrl';

/** 事件：事件类型目录、本项目的订阅与投递记录、死信重放。 */
export interface EventsResource {
  /** GET /v1/catalog/event-types */
  listEventTypes(): Promise<ItemsPage<EventTypeDto>>;
  /** GET /v1/projects/:projectId/subscriptions */
  listSubscriptions(projectId: string): Promise<ItemsPage<SubscriptionDto>>;
  /** GET /v1/projects/:projectId/deliveries?state=&limit= */
  listDeliveries(projectId: string, query?: ListDeliveriesInput): Promise<ItemsPage<DeliveryDto>>;
  /** POST /v1/deliveries/:id/replay（负责人把死信重新入队） */
  replayDelivery(deliveryId: string): Promise<DeliveryDto>;
}

export function eventsResource(transport: Transport): EventsResource {
  const project = (projectId: string) => `/v1/projects/${segment(projectId)}`;
  return {
    listEventTypes: () => transport.request<ItemsPage<EventTypeDto>>('GET', '/v1/catalog/event-types'),
    listSubscriptions: (projectId) => transport.request<ItemsPage<SubscriptionDto>>('GET', `${project(projectId)}/subscriptions`),
    listDeliveries: (projectId, query) => transport.request<ItemsPage<DeliveryDto>>('GET', `${project(projectId)}/deliveries`, { query }),
    replayDelivery: (deliveryId) => transport.request<DeliveryDto>('POST', `/v1/deliveries/${segment(deliveryId)}/replay`),
  };
}
