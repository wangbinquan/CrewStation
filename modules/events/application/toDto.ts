import type { DeliveryDto, EventTypeDto, SubscriptionDto } from '@crewstation/contracts';
import type { Delivery } from '../domain/delivery';
import type { EventType } from '../domain/producer';
import type { Subscription } from '../domain/subscription';

export function eventTypeToDto(type: EventType): EventTypeDto {
  return { id: type.id, name: type.name, producerId: type.producerId, state: type.state, eventType: type.eventType, producer: type.producer, producerProject: type.producerProject, ...(type.schemaRef === undefined ? {} : { schemaRef: type.schemaRef }) };
}

export function subscriptionToDto(subscription: Subscription): SubscriptionDto {
  return { id: subscription.id, serviceId: subscription.serviceId, eventTypeId: subscription.eventTypeId, eventType: subscription.eventType, handlerPath: subscription.handlerPath, state: subscription.state };
}

export function deliveryToDto(delivery: Delivery): DeliveryDto {
  return {
    id: delivery.id,
    eventId: delivery.eventId,
    eventTypeId: delivery.eventTypeId,
    eventType: delivery.eventType,
    subscriptionId: delivery.subscriptionId,
    state: delivery.state,
    attempts: delivery.attempts,
    ...(delivery.nextAttemptAt === undefined ? {} : { nextAttemptAt: delivery.nextAttemptAt.toISOString() }),
    ...(delivery.lastError === undefined ? {} : { lastError: delivery.lastError }),
    traceId: delivery.traceId,
    ...(delivery.deliveredAt === undefined ? {} : { deliveredAt: delivery.deliveredAt.toISOString() }),
  };
}
