import type { DomainPayload } from '@crewstation/contracts';
import { conflict, newId, notFound } from '@crewstation/kernel';
import type { EventType, Producer } from '../domain/producer';
import { reconcileSubscriptions } from '../domain/subscription';
import type { RepositoryScope } from '../ports/unitOfWork';
import type { EventsUseCaseDeps } from './dependencies';

type ReleaseRegistered = DomainPayload<'release.registered'>;

/**
 * 消费 release.registered：EventProducer 按 `spec.producer` 登记生产方与 `produces` 事件类型，
 * 数字人用 `subscriptions` 段替换自己的订阅。幂等，事件重放安全。
 */
export function registerReleaseUseCase({ uow, services, clock }: EventsUseCaseDeps) {
  return async (event: ReleaseRegistered): Promise<void> => {
    const { manifest } = event;
    if (manifest.kind === 'APIProxy') return;
    const now = clock.now();
    if (manifest.kind === 'EventProducer') {
      const resolved = await services.resolveService(event.serviceId);
      if (!resolved) throw notFound('服务', event.serviceId);
      const producer: Producer = {
        producer: manifest.spec.producer, serviceId: event.serviceId, projectId: event.projectId,
        projectSlug: resolved.slug, serviceIdentity: resolved.identity, updatedAt: now,
      };
      const types: EventType[] = manifest.spec.produces.map((p) => ({
        eventType: p.eventType, producer: producer.producer, producerProject: resolved.slug, ...(p.schema === undefined ? {} : { schemaRef: p.schema }),
      }));
      await uow.run((scope) => registerProducer(scope, producer, types));
      return;
    }
    await uow.run(async (scope) => {
      const existing = await scope.subscriptions.listByService(event.serviceId);
      const owner = { serviceId: event.serviceId, projectId: event.projectId };
      const changes = reconcileSubscriptions(existing, manifest.spec.subscriptions, owner, () => newId('sbs'), now);
      for (const id of changes.removedIds) await scope.subscriptions.remove(id);
      for (const subscription of changes.upserts) await scope.subscriptions.upsert(subscription);
    });
  };
}

/** 生产方名与事件类型都是全局唯一的名字：被别的服务占用时拒绝，让发布方在死信里看到原因。 */
async function registerProducer(scope: RepositoryScope, producer: Producer, types: readonly EventType[]): Promise<void> {
  const existing = await scope.producers.getByName(producer.producer);
  if (existing && existing.serviceId !== producer.serviceId) {
    throw conflict(`生产方名 ${producer.producer} 已被服务 ${existing.serviceId} 使用`, { producer: producer.producer });
  }
  for (const type of types) {
    const owner = await scope.eventTypes.getByEventType(type.eventType);
    if (owner && owner.producer !== producer.producer) {
      throw conflict(`事件类型 ${type.eventType} 已由生产方 ${owner.producer} 声明`, { eventType: type.eventType });
    }
  }
  await scope.producers.upsert(producer);
  await scope.eventTypes.replaceForProducer(producer.producer, types);
}
