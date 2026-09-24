import type { Actor, ClusterInspection, ClusterInspectRequest, ClusterOperation, ClusterResource, ServiceId, UserId } from '@crewstation/contracts';
import { conflict, forbidden, isPlatformError, precondition } from '@crewstation/kernel';
import type { RepositoryScope } from '../ports/unitOfWork';
import type { SlotControl } from '../ports/slotControl';
import type { SlotMaintenance } from '../domain/slotMaintenance';
import { slotRolloutOf } from '../domain/ledgerProjection';
import { hasWorkload } from '../domain/slotLifecycle';
import type { PhysicalSlot, ServiceSlots } from '../domain/slots';
import { withSlot } from '../domain/slots';
import type { ReleaseUseCaseDeps } from './dependencies';
import { offlineInScope } from './slotLifecycle';

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
/**
 * 资源中心建的槽（RFC-025 T8，C6「执行改为写期望」）：执行即在同一事务里改槽的期望——扩缩与恢复写副本数，重启写重启标记，删除即下线
 * （与项目侧下线同一个结果，RFC-021 B7）；调和器照期望应用，结果随观测回到槽记录。
 */
async function applyToWorkload(scope: RepositoryScope, slots: ServiceSlots, physical: PhysicalSlot, operation: ClusterOperation, replicas: number | undefined, now: Date): Promise<void> {
  const slot = slots[physical], workload = slot.workload!;
  if (operation.action === 'delete') {
    if (hasWorkload(slot)) await offlineInScope(scope, slots, physical, now, { reason: 'cluster', actorUserId: operation.actorId as UserId, workloadRemoved: true });
    return;
  }
  const next = operation.action === 'restart' ? { ...workload, restartedAt: now.toISOString() } : { ...workload, replicas: replicas ?? workload.replicas };
  await scope.slots.save(withSlot(slots, { ...slot, workload: next, updatedAt: now }, now));
}

/** 资源中心建的槽的运维进度：照槽记录判——删除看 Deployment 没了，其余看新期望铺完、副本数对上；推进超时算失败。 */
async function observeViaLedger(deps: Deps, operation: ClusterOperation, replicas: number | undefined): Promise<{ done: boolean; failed?: boolean; reason: string; replicas: number; readyReplicas: number }> {
  const found = await deps.uow.read.ledger?.slot(operation.target.serviceId as ServiceId, operation.target.physicalSlot!);
  if (operation.action === 'delete') {
    const gone = !found?.children?.some((child) => child.kind === 'Deployment' && child.phase !== 'absent');
    return { done: gone, reason: gone ? '发布槽已删除' : '等待原发布槽删除', replicas: 0, readyReplicas: 0 };
  }
  const rollout = slotRolloutOf(found), counts = { replicas: rollout.replicas, readyReplicas: rollout.readyReplicas };
  if (rollout.state === 'failed') return { done: true, failed: true, reason: rollout.message ?? '部署停止推进', ...counts };
  const done = rollout.state === 'ready' && (replicas === undefined || rollout.replicas === replicas);
  return { done, reason: done ? '发布槽已就绪' : rollout.message ?? `等待发布槽就绪：${rollout.readyReplicas}/${rollout.replicas}`, ...counts };
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
        const slots = await scope.slots.get(operation.target.serviceId as ServiceId);
        const old = await scope.maintenance.get(operation.operationId); if (old) return old;
        const result = await check(deps, scope, actor, operation.target, operation.params, operation.operationId);
        const next: SlotMaintenance = { operation, inspection, state: 'prepared', ...(result.replicas === undefined ? {} : { replicas: result.replicas }) };
        const physical = operation.target.physicalSlot!;
        if (slots?.[physical].workload) {
          await applyToWorkload(scope, slots, physical, operation, result.replicas, deps.clock.now());
          const applied: SlotMaintenance = { ...next, state: 'applied' };
          await scope.maintenance.save(applied); return applied;
        }
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
      const ledgerShaped = !!(await deps.uow.read.slots.get(operation.target.serviceId as ServiceId))?.[operation.target.physicalSlot!].workload;
      const status = ledgerShaped ? await observeViaLedger(deps, record.operation, record.replicas) : await deps.slotControl.observe(record.operation, record.replicas);
      if (status.done && record.state !== 'done') await deps.uow.run(async (scope) => {
        const id = operation.target.serviceId as ServiceId, physical = operation.target.physicalSlot!;
        const slots = await scope.slots.get(id); if (!slots) throw precondition('部署槽记录不存在');
        if (!status.failed) {
          if (operation.action === 'scale') await scope.maintenance.setOverride(id, physical, record.replicas);
          if (operation.action === 'restore-replicas') await scope.maintenance.setOverride(id, physical);
          // 集群管理删除非正式槽与项目侧「下线」是同一个结果（RFC-021 B7）：版本转已下线、可从发布记录重新部署。
          if (operation.action === 'delete' && slots.active !== physical && hasWorkload(slots[physical])) await offlineInScope(scope, slots, physical, deps.clock.now(), { reason: 'cluster', actorUserId: operation.actorId as UserId, workloadRemoved: true });
          else if (operation.action !== 'delete') await scope.slots.save(withSlot(slots, { ...slots[physical], state: 'ready', replicas: status.replicas, readyReplicas: status.readyReplicas, updatedAt: deps.clock.now() }, deps.clock.now()));
        }
        await scope.maintenance.save({ ...record, state: status.failed ? 'failed' : 'done' });
      });
      return status;
    },
  };
}
