import type { Actor, ServiceId, TrafficSwitchDto, TrafficSwitchRequest } from '@crewstation/contracts';
import { DomainTopic } from '@crewstation/contracts';
import { newId, notFound, precondition } from '@crewstation/kernel';
import { rollbackBlockedBy } from '../domain/migrationPolicy';
import { physicalOf, roleOf, switchTraffic } from '../domain/slots';
import type { ReleaseUseCaseDeps } from './dependencies';
import { switchToDto } from './toDto';

/** 晋级与回退都是负责人的一次切流（G15）；破坏性迁移之后禁止切回旧版本。 */
export function switchTrafficUseCase(deps: ReleaseUseCaseDeps) {
  const { uow, authorizer, services, clock } = deps;
  return async (actor: Actor, serviceId: ServiceId, input: TrafficSwitchRequest): Promise<TrafficSwitchDto> => {
    const svc = await services.resolveServiceById(serviceId);
    if (!svc) throw notFound('服务', serviceId);
    await authorizer.authorize(actor, svc.projectId, 'switch-traffic');
    const now = clock.now();
    return uow.run(async (scope) => {
      const slots = await scope.slots.get(serviceId);
      if (!slots) throw precondition('服务尚无任何部署');
      const target = physicalOf(slots, input.toSlot);
      const currentRelease = slots[slots.active].releaseId ? await scope.releases.getById(slots[slots.active].releaseId!) : undefined;
      const targetRelease = slots[target].releaseId ? await scope.releases.getById(slots[target].releaseId!) : undefined;
      if (currentRelease?.manifest && targetRelease && targetRelease.createdAt < currentRelease.createdAt && rollbackBlockedBy(currentRelease.manifest.spec.release.migration)) {
        throw precondition(`当前版本 ${currentRelease.tag} 含破坏性迁移，不能切回旧版本 ${targetRelease.tag}`);
      }
      const next = switchTraffic(slots, input.toSlot, input.expectedActiveRelease, now);
      await scope.slots.save(next);
      // 切流永远是「待命槽接管生产流量」：目标槽切之前的角色是 preview，切之后是 prod。
      // 记的是发布的迁移，不是物理槽的名字，所以 fromSlot 取目标槽的旧角色而不是当前 active 槽的角色。
      const record = {
        id: newId('tsw'), serviceId, fromSlot: roleOf(slots, target), toSlot: roleOf(next, target), releaseId: next[next.active].releaseId!,
        ...(currentRelease ? { previousReleaseId: currentRelease.id } : {}),
        actorUserId: actor.userId, ...(input.reason ? { reason: input.reason } : {}), createdAt: now,
      };
      await scope.switches.insert(record);
      await scope.events.publish(DomainTopic.trafficSwitched, { occurredAt: now.toISOString(), projectId: svc.projectId, serviceId, fromSlot: 'preview', toSlot: 'prod', releaseId: record.releaseId, actorUserId: actor.userId });
      return switchToDto(record);
    });
  };
}
