import type { Actor, ClusterInspection, ClusterInspectRequest, ClusterOperation, ClusterResource, ServiceId } from '@crewstation/contracts';
import { conflict, forbidden, isPlatformError, precondition } from '@crewstation/kernel';
import type { RepositoryScope } from '../ports/unitOfWork';
import type { SlotControl } from '../ports/slotControl';
import type { SlotMaintenance } from '../domain/slotMaintenance';
import { withSlot } from '../domain/slots';
import type { ReleaseUseCaseDeps } from './dependencies';

type Deps = ReleaseUseCaseDeps & { slotControl: SlotControl; isAdmin(id: Actor['userId']): Promise<boolean> };
async function check(deps: Deps, scope: RepositoryScope, actor: Actor, target: ClusterResource, request: ClusterInspectRequest, operationId?: string) {
  if (!actor.isAdmin || !await deps.isAdmin(actor.userId)) throw forbidden();
  const id = target.serviceId as ServiceId, physical = target.physicalSlot;
  if (!physical) throw precondition('缺少物理部署槽');
  const slots = await scope.slots.get(id); if (!slots) throw precondition('部署槽不存在');
  const projection = (await scope.maintenance.projection(id)).find((s) => s.physical === physical);
  if (!projection || projection.revision !== target.domainRevision) throw conflict('部署槽角色或发布配置已变化');
  const pending = await scope.maintenance.active(id);
  if (pending && pending.operation.operationId !== operationId) throw precondition(`运维操作 ${pending.operation.operationId} 尚未结束`);
  const release = await scope.releases.findInProgress(id);
  if (release) throw precondition(`发布 ${release.tag} 仍在 ${release.status}，请等待发布完成`);
  if (request.action === 'delete' && slots.active === physical) throw precondition('正式槽正在承接流量，请先切流');
  const plan = projection.plan ? await deps.plans.getServicePlan(projection.plan) : undefined;
  const replicas = request.action === 'scale' ? request.replicas : request.action === 'restore-replicas' ? projection.manifestReplicas : undefined;
  if ((request.action === 'scale' || request.action === 'restore-replicas') && (!plan || !replicas || replicas > plan.maxReplicas)) throw precondition(`副本数超过套餐上限 ${plan?.maxReplicas ?? 0}，或当前发布配置缺失`);
  if (request.action === 'scale' || request.action === 'restore-replicas') await deps.slotControl.inspect(target);
  return { projection, replicas, maxReplicas: plan?.maxReplicas ?? 1 };
}
export function slotMaintenanceUseCases(deps: Deps) {
  return {
    listClusterSlots: () => deps.uow.read.maintenance.projection(),
    inspectSlotOperation: async (actor: Actor, target: ClusterResource, request: ClusterInspectRequest): Promise<Pick<ClusterInspection, 'capability' | 'domain'>> => {
      const capability = target.availableActions.find((a) => a.action === request.action)!;
      try { const result = await check(deps, deps.uow.read, actor, target, request); return { capability: { ...capability, minReplicas: 1, maxReplicas: result.maxReplicas }, domain: { revision: result.projection.revision, replicas: result.replicas ?? null } }; }
      catch (e) { return { capability: { ...capability, enabled: false, reason: e instanceof Error ? e.message : String(e) } }; }
    },
    executeSlotOperation: async (actor: Actor, operation: ClusterOperation, inspection: ClusterInspection) => {
      const record = await deps.uow.run(async (scope): Promise<SlotMaintenance> => {
        await scope.slots.get(operation.target.serviceId as ServiceId);
        const old = await scope.maintenance.get(operation.operationId); if (old) return old;
        const result = await check(deps, scope, actor, operation.target, operation.params, operation.operationId);
        const next: SlotMaintenance = { operation, inspection, state: 'prepared', ...(result.replicas === undefined ? {} : { replicas: result.replicas }) };
        await scope.maintenance.save(next); return next;
      });
      if (record.state === 'prepared') {
        try { await deps.slotControl.apply(record.operation, record.replicas); await deps.uow.read.maintenance.save({ ...record, state: 'applied' }); }
        catch (e) {
          if (isPlatformError(e) && ['conflict', 'precondition', 'validation', 'forbidden', 'not_found'].includes(e.kind)) await deps.uow.read.maintenance.save({ ...record, state: 'failed', error: e.message });
          throw e; // Ambiguous failures retain the durable intent for reconciliation.
        }
      }
      return { operationId: operation.operationId };
    },
    observeSlotOperation: async (operation: ClusterOperation) => {
      const record = await deps.uow.read.maintenance.get(operation.operationId); if (!record) throw precondition('发布槽操作意图不存在');
      const status = await deps.slotControl.observe(record.operation, record.replicas);
      if (status.done && record.state !== 'done') await deps.uow.run(async (scope) => {
        const id = operation.target.serviceId as ServiceId, physical = operation.target.physicalSlot!;
        const slots = await scope.slots.get(id); if (!slots) throw precondition('部署槽记录不存在');
        if (!status.failed) {
          if (operation.action === 'scale') await scope.maintenance.setOverride(id, physical, record.replicas);
          if (operation.action === 'restore-replicas') await scope.maintenance.setOverride(id, physical);
          await scope.slots.save(withSlot(slots, { ...slots[physical], state: operation.action === 'delete' ? 'empty' : 'ready', replicas: status.replicas, readyReplicas: status.readyReplicas, updatedAt: deps.clock.now() }, deps.clock.now()));
        }
        await scope.maintenance.save({ ...record, state: status.failed ? 'failed' : 'done' });
      });
      return status;
    },
  };
}
