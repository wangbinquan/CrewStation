import type { EventId, ProducedEvent, ProduceResultDto, ServiceActor, TraceId } from '@crewstation/contracts';
import { forbidden, newId, newTraceId, notFound } from '@crewstation/kernel';
import { newDelivery } from '../domain/delivery';
import type { InboxEvent } from '../domain/inboxEvent';
import type { EventsUseCaseDeps } from './dependencies';

/**
 * 生产方投递：调用方身份（网关按源 Pod IP 注入）必须是该事件类型登记的生产方；
 * inbox 以 (producer, dedupKey) 去重，命中时返回已有事件且不再产生投递；否则为每个活动订阅建一条投递并入队。
 */
export function produceEventUseCase({ uow, clock }: EventsUseCaseDeps) {
  return async (caller: ServiceActor, input: ProducedEvent): Promise<ProduceResultDto> => {
    const type = await uow.read.eventTypes.getByEventType(input.eventType);
    if (!type) throw notFound('事件类型', input.eventType);
    const producer = await uow.read.producers.getByName(type.producer);
    if (!producer || producer.serviceIdentity !== caller.identity) {
      throw forbidden(`服务 ${caller.identity} 不是事件 ${input.eventType} 的生产方`);
    }
    const now = clock.now();
    const event: InboxEvent = {
      id: newId('evt') as EventId, producer: producer.producer, producerProject: producer.projectSlug, eventType: input.eventType,
      dedupKey: input.dedupKey, occurredAt: new Date(input.occurredAt), receivedAt: now,
      traceId: (input.traceId ?? newTraceId()) as TraceId, payload: input.payload ?? null,
    };
    return uow.run(async (scope) => {
      if (!(await scope.inbox.insert(event))) {
        const existing = await scope.inbox.getByDedup(event.producer, event.dedupKey);
        return { eventId: existing?.id ?? event.id, deduplicated: true, deliveries: 0 };
      }
      const subscriptions = await scope.subscriptions.listActiveByEventType(event.eventType);
      for (const subscription of subscriptions) {
        const delivery = newDelivery(newId('dlv'), event, subscription, now);
        await scope.deliveries.insert(delivery);
        await scope.scheduler.schedule(delivery.id);
      }
      return { eventId: event.id, deduplicated: false, deliveries: subscriptions.length };
    });
  };
}
