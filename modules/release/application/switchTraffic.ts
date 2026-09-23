import type { Actor, ServiceId, TrafficSwitchDto, TrafficSwitchRequest } from '@crewstation/contracts';
import { DomainTopic } from '@crewstation/contracts';
import { newId, notFound, precondition } from '@crewstation/kernel';
import { assertSwitchAllowed, rollbackBlockedBy } from '../domain/migrationPolicy';
import { physicalOf, roleOf, switchTraffic } from '../domain/slots';
import type { ReleaseUseCaseDeps } from './dependencies';
import { switchToDto } from './toDto';

/** 晋级与回退都是负责人的一次切流（G15）；破坏性迁移之后禁止切回旧版本。 */
export function switchTrafficUseCase(deps: Pick<ReleaseUseCaseDeps, 'uow' | 'authorizer' | 'services' | 'clock' | 'maintenance'>) {
  const { uow, authorizer, services, clock, maintenance } = deps;
  return async (actor: Actor, serviceId: ServiceId, input: TrafficSwitchRequest): Promise<TrafficSwitchDto> => {
    const svc = await services.resolveServiceById(serviceId);
    if (!svc) throw notFound('服务', serviceId);
    await authorizer.authorize(actor, svc.projectId, 'switch-traffic');
    // 维护窗口在事务外读（跨模块查询）；目标版本在事务内锁槽之后再核对一次是否就是它。
    const windowOpen = await maintenance.open(serviceId);
    const now = clock.now();
    return uow.run(async (scope) => {
      const slots = await scope.slots.get(serviceId);
      if (!slots) throw precondition('服务尚无任何部署');
      if (await scope.maintenance.active(serviceId)) throw precondition('集群运维操作尚未结束，请等待后再切流');
      const next = switchTraffic(slots, input.toSlot, input.expectedActiveRelease, now, input.expectedTargetRelease);
      // publish 在同一槽锁内登记目标；流水线结束前不能把它将覆盖的待命槽变成线上。
      const inProgress = await scope.releases.findInProgress(serviceId);
      if (inProgress) throw precondition(`发布 ${inProgress.tag} 仍在进行中（${inProgress.status}），请等待结束后重新确认上线或回退`, { releaseId: inProgress.id });
      const target = physicalOf(slots, input.toSlot);
      const currentRelease = slots[slots.active].releaseId ? await scope.releases.getById(slots[slots.active].releaseId!) : undefined;
      const targetRelease = slots[target].releaseId ? await scope.releases.getById(slots[target].releaseId!) : undefined;
      if (currentRelease?.manifest && targetRelease && targetRelease.createdAt < currentRelease.createdAt && rollbackBlockedBy(currentRelease.manifest.spec.release.migration)) {
        const restriction = currentRelease.manifest.spec.release.migration.destructive ? '含破坏性迁移' : '的发布配置明确禁止回退';
        throw precondition(`当前版本 ${currentRelease.tag} ${restriction}，不能切回旧版本 ${targetRelease.tag}`);
      }
      // 切流到含破坏性迁移的版本同样要求维护窗口（Design §6.5「部署与切流」，RFC-021 M27）。
      if (targetRelease) assertSwitchAllowed(targetRelease.manifest?.spec.release.migration, targetRelease.tag, windowOpen);
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
