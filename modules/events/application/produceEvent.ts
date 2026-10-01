import type { EventId, LegacyProducedEvent, ProducedEvent, ProduceResultDto, ProjectServiceActor, TraceId } from '@crewstation/contracts';
import { forbidden, newResourceId, newTraceId, notFound } from '@crewstation/kernel';
import { newDelivery } from '../domain/delivery';
import type { InboxEvent } from '../domain/inboxEvent';
import type { EventsUseCaseDeps } from './dependencies';

/**
 * 生产方投递：调用方身份（网关按源 Pod IP 注入）必须是该事件类型登记的生产方；
 * inbox 以 (producer, dedupKey) 去重，命中时返回已有事件且不再产生投递；否则为每个活动订阅建一条投递并入队。
 */
export function produceEventUseCase({ uow, clock }: EventsUseCaseDeps) {
  return async (caller: ProjectServiceActor, input: ProducedEvent): Promise<ProduceResultDto> => {
    const type = await uow.read.eventTypes.getById(input.eventTypeId);
    if (!type || type.state !== 'active') throw notFound('事件类型', input.eventTypeId);
    const producer = await uow.read.producers.getById(type.producerId);
    if (!producer || producer.serviceIdentity !== caller.identity || producer.projectId !== caller.projectId || producer.serviceId !== caller.serviceId) {
      throw forbidden(`服务 ${caller.identity} 不是事件 ${input.eventTypeId} 的生产方`);
    }
    const now = clock.now();
    const event: InboxEvent = {
      id: newResourceId() as EventId, producerId: producer.id, producer: producer.producer, producerProject: producer.projectSlug, eventTypeId: type.id, eventType: type.eventType,
      dedupKey: input.dedupKey, occurredAt: new Date(input.occurredAt), receivedAt: now,
      traceId: (input.traceId ?? newTraceId()) as TraceId, payload: input.payload ?? null,
    };
    const candidates = await uow.read.subscriptions.listActiveByEventType(type.id);
    return uow.withAdmission([producer.projectId,...candidates.map((s) => s.projectId)],() => uow.run(async (scope) => {
      const fresh = await scope.eventTypes.getById(type.id);
      if (!fresh || fresh.state !== 'active' || fresh.producerId !== producer.id) throw notFound('事件类型',input.eventTypeId);
      if (!(await scope.inbox.insert(event))) {
        const existing = await scope.inbox.getByDedup(event.producerId, event.dedupKey);
        return { eventId: existing?.id ?? event.id, deduplicated: true, deliveries: 0 };
      }
      const subscriptions = await scope.subscriptions.listActiveByEventType(event.eventTypeId);
      for (const subscription of subscriptions) {
        const delivery = newDelivery(newResourceId(), event, subscription, now);
        await scope.deliveries.insert(delivery);
        await scope.scheduler.schedule(delivery.id);
      }
      return { eventId: event.id, deduplicated: false, deliveries: subscriptions.length };
    }));
  };
}

/** Explicit v1 business ingress: resolve a protocol code, then use the same UUID-only acceptance path. */
export function produceLegacyEventUseCase(deps: EventsUseCaseDeps) {
  const produce = produceEventUseCase(deps);
  return async (caller: ProjectServiceActor, input: LegacyProducedEvent): Promise<ProduceResultDto> => {
    const type = await deps.uow.read.eventTypes.getByCode(input.eventType);
    if (!type) throw notFound('事件编码', input.eventType);
    return produce(caller, { ...input, eventTypeId: type.id });
  };
}
