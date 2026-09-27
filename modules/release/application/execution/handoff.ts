import { DomainTopic } from '@crewstation/contracts';
import type { Actor, ServiceId, TrafficSwitchDto } from '@crewstation/contracts';
import { conflict, newResourceId, notFound, precondition } from '@crewstation/kernel';
import type { ExecutionHandoffOperation } from '../../domain/executionHandoff';
import { handoffSwitchDto } from '../../domain/executionHandoff';
import { switchTraffic } from '../../domain/slots';
import { assertSwitchAllowed } from '../../domain/migrationPolicy';
import type { ReleaseUseCaseDeps } from '../dependencies';
import type { HandoffRequest } from '../../ports/executionHandoff';

type HandoffDeps = Pick<ReleaseUseCaseDeps, 'uow' | 'services' | 'authorizer' | 'executionHandoff' | 'clock' | 'maintenance'>;
const requestOf = (op: ExecutionHandoffOperation): HandoffRequest => ({ operationId: op.id, expectedActiveReleaseId: op.expectedActiveReleaseId, targetReleaseId: op.targetReleaseId, targetSlot: op.targetSlot });
export function releaseHandoffUseCases(deps: HandoffDeps) {
  return {
    latestHandoff: async (actor: Actor, serviceId: ServiceId): Promise<TrafficSwitchDto | null> => {
      const service = await deps.services.resolveServiceById(serviceId); if (!service) throw notFound('服务', serviceId);
      await deps.authorizer.authorize(actor, service.projectId, 'view');
      const operation = await deps.uow.read.handoffs.latest(serviceId); return operation ? handoffSwitchDto(operation) : null;
    },
    getHandoff: async (actor: Actor, serviceId: ServiceId, id: string): Promise<TrafficSwitchDto> => {
      const service = await deps.services.resolveServiceById(serviceId); if (!service) throw notFound('服务', serviceId);
      await deps.authorizer.authorize(actor, service.projectId, 'view');
      const operation = await deps.uow.read.handoffs.get(id); if (!operation || operation.serviceId !== serviceId) throw notFound('执行交接', id);
      return handoffSwitchDto(operation);
    },
    progressHandoffs: async (): Promise<number> => {
      let count = 0;
      for (const candidate of await deps.uow.read.handoffs.pending(20)) {
        const claimed = await deps.uow.read.handoffs.claim(candidate.id, newResourceId()); if (!claimed) continue;
        try { await advanceHandoff(deps, claimed); }
        catch (error) { await deps.uow.read.handoffs.settle(claimed, { stage: claimed.stage, message: error instanceof Error ? error.message : '交接状态暂不可确认' }); }
        count++;
      }
      return count;
    },
  };
}
async function advanceHandoff(deps: HandoffDeps, op: ExecutionHandoffOperation): Promise<void> {
  const port = deps.executionHandoff; if (!port) throw precondition('执行交接端口尚未配置');
  const settle = (stage: ExecutionHandoffOperation['stage'], extra: Partial<ExecutionHandoffOperation> = {}) => deps.uow.read.handoffs.settle(op, { stage, ...extra });
  if (op.stage === 'freezing') {
    const frozen = await port.freeze(op.serviceId, requestOf(op));
    await settle(frozen.quiescent ? 'preparing' : 'freezing', { epoch: frozen.epoch }); return;
  }
  const authority = await port.inspect(op.serviceId);
  if (authority.operationId !== op.id || authority.targetReleaseId !== op.targetReleaseId || authority.targetSlot !== op.targetSlot) throw conflict('执行权记录与交接目标不一致');
  if (op.stage === 'preparing') {
    if (authority.stage !== 'prepared' || !authority.preparationDigest || !authority.quiescent) { await settle('preparing'); return; }
    await settle('routing', { epoch: authority.epoch, preparationDigest: authority.preparationDigest }); return;
  }
  if (op.stage === 'routing') {
    if (!authority.preparationDigest || !authority.quiescent || authority.epoch !== op.epoch || authority.preparationDigest !== op.preparationDigest || !['prepared', 'routed'].includes(authority.stage)) { await settle('preparing'); return; }
    await commitRoute(deps, op); return;
  }
  if (op.stage === 'activating') {
    if (!await port.observeRoute(op.serviceId, op.targetReleaseId, op.targetSlot)) { await settle('activating', { message: '等待目标生产路由实际生效' }); return; }
    if (authority.stage !== 'complete') await port.routeObserved(op.serviceId, requestOf(op));
    const observed = await port.inspect(op.serviceId);
    if (observed.stage !== 'complete') { await settle('activating', { epoch: observed.epoch, message: '等待目标应用激活执行权' }); return; }
    await deps.uow.run(async (scope) => {
      if (!await scope.handoffs.settle(op, { stage: 'complete', epoch: observed.epoch })) return;
      await scope.switches.insert({ id: op.id, serviceId: op.serviceId, fromSlot: 'preview', toSlot: 'prod', releaseId: op.targetReleaseId,
        ...(op.expectedActiveReleaseId ? { previousReleaseId: op.expectedActiveReleaseId } : {}), actorUserId: op.actorUserId, reason: op.reason, createdAt: new Date(op.createdAt) });
    });
  }
}
async function commitRoute(deps: HandoffDeps, op: ExecutionHandoffOperation): Promise<void> {
  const windowOpen = await deps.maintenance.open(op.serviceId);
  await deps.uow.run(async (scope) => {
    const slots = await scope.slots.get(op.serviceId);
    if (!slots || slots[op.targetSlot].releaseId !== op.targetReleaseId || slots[op.targetSlot].state !== 'ready') throw conflict('交接目标部署已经变化');
    const target = await scope.releases.getById(op.targetReleaseId);
    if (!target) throw precondition('交接目标发布不存在');
    assertSwitchAllowed(target.manifest?.spec.release.migration, target.tag, windowOpen);
    const now = deps.clock.now();
    if (!await scope.handoffs.settle(op, { stage: 'activating' })) return;
    if (slots.active === op.targetSlot && slots[slots.active].releaseId === op.targetReleaseId) return;
    const next = switchTraffic(slots, 'preview', op.expectedActiveReleaseId, now, op.targetReleaseId);
    await scope.slots.save(next);
    await scope.events.publish(DomainTopic.trafficSwitched, { occurredAt: now.toISOString(), projectId: op.projectId, serviceId: op.serviceId, fromSlot: 'preview', toSlot: 'prod', releaseId: op.targetReleaseId, actorUserId: op.actorUserId });
  });
}
