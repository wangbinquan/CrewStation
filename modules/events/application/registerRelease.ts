import type { DomainPayload } from '@crewstation/contracts';
import { conflict, newResourceId, notFound } from '@crewstation/kernel';
import type { EventType } from '../domain/producer';
import { reconcileSubscriptions } from '../domain/subscription';
import type { EventsUseCaseDeps } from './dependencies';

/** Release declarations bind protocol codes to persistent resource identities. Replays retain IDs. */
export function registerReleaseUseCase({ uow, services, clock }: EventsUseCaseDeps) {
  return async (event: DomainPayload<'release.registered'>): Promise<void> => {
    const { manifest } = event;
    if (manifest.kind === 'APIProxy') return;
    const now = clock.now();
    await uow.run(async (scope) => {
      if (manifest.kind === 'EventProducer') {
        const resolved = await services.resolveService(event.serviceId);
        if (!resolved) throw notFound('服务', event.serviceId);
        const byCode = await scope.producers.getByCode(manifest.spec.producer);
        if (byCode && byCode.serviceId !== event.serviceId) throw conflict(`生产方编码 ${manifest.spec.producer} 已被占用`);
        const previous = byCode ?? await scope.producers.getByService(event.serviceId);
        const producer = {
          id: previous?.id ?? newResourceId(), name: previous?.name ?? manifest.spec.producer,
          producer: manifest.spec.producer, serviceId: event.serviceId, projectId: event.projectId,
          projectSlug: resolved.slug, serviceIdentity: resolved.identity, updatedAt: now,
        };
        const types: EventType[] = [];
        for (const declaration of manifest.spec.produces) {
          const existing = await scope.eventTypes.getByCode(declaration.eventType);
          if (existing && existing.producerId !== producer.id) throw conflict(`事件编码 ${declaration.eventType} 已被其他生产方占用`);
          types.push({ id: existing?.id ?? newResourceId(), name: existing?.name ?? declaration.eventType,
            eventType: declaration.eventType, producerId: producer.id, producer: producer.producer,
            producerProject: resolved.slug, state: 'active', ...(declaration.schema ? { schemaRef: declaration.schema } : {}) });
        }
        await scope.producers.upsert(producer);
        await scope.eventTypes.replaceForProducer(producer.id, types);
        return;
      }
      const declared = [];
      for (const subscription of manifest.spec.subscriptions) {
        const type = await scope.eventTypes.getById(subscription.eventTypeId);
        if (!type || type.state !== 'active') throw notFound('事件类型', subscription.eventTypeId);
        declared.push({ ...subscription, eventType: type.eventType });
      }
      const existing = await scope.subscriptions.listByService(event.serviceId);
      const changes = reconcileSubscriptions(existing, declared, event, newResourceId, now);
      for (const id of changes.removedIds) await scope.subscriptions.remove(id);
      for (const subscription of changes.upserts) await scope.subscriptions.upsert(subscription);
    });
  };
}
