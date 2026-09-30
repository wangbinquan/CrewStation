import { AcceptProjectDeletionSchema, DomainTopic, ProjectDeletionPlanSchema } from '@crewstation/contracts';
import type { AcceptProjectDeletion, Actor, ProjectDeletionInventory } from '@crewstation/contracts';
import { conflict, newId, precondition } from '@crewstation/kernel';
import { assertReconfirmable, confirmedRequestMatches, reconfirmationInventory } from '../../domain/deletion/reconfirmation';
import type { ProjectUseCaseDeps } from '../dependencies';
import { adminDeletionWork, deletionScope, loadDeletion } from './access';

export function deletionReconfirmationUseCases(deps: ProjectUseCaseDeps) {
  return {
    prepareProjectDeletionReconfirmation: (actor: Actor, id: string, reports: readonly ProjectDeletionInventory[]) => adminDeletionWork(deps, actor, () => deps.uow.run(async (scope) => {
      const current = await loadDeletion(scope, id, true); assertReconfirmable(current);
      const previous = await scope.deletions.getPlan(current.planId); if (!previous) throw precondition('原清理计划缺失');
      await scope.deletions.lockProject(current.operation.project.id);
      const target = await deletionScope(deps, current.operation.project.id, scope), now = deps.clock.now();
      const plan = ProjectDeletionPlanSchema.parse({ id: newId('pdp'), operationId: id, supersedes: current.operation.confirmationDigest, target,
        ...reconfirmationInventory(target, previous.plan, current, reports), expiresAt: new Date(now.getTime() + 600_000).toISOString() });
      await scope.deletions.insertPlan({ plan, requestedBy: actor.userId, createdAt: now }); return plan;
    })),
    replayProjectDeletionReconfirmation: (actor: Actor, id: string, raw: AcceptProjectDeletion) => adminDeletionWork(deps, actor, async () => {
      const input = AcceptProjectDeletionSchema.parse(raw), previous = await deps.uow.read.deletions.findRequest(input.requestKey);
      if (!previous) return undefined;
      if (previous.operation.id !== id) throw conflict('重新确认请求键已用于其他操作');
      confirmedRequestMatches(previous, previous.operation.project.id, input); return previous.operation;
    }),
    reconfirmProjectDeletion: (actor: Actor, id: string, raw: AcceptProjectDeletion, reports: readonly ProjectDeletionInventory[]) => adminDeletionWork(deps, actor, () => deps.uow.run(async (scope) => {
      const input = AcceptProjectDeletionSchema.parse(raw); await scope.deletions.lockRequest(input.requestKey);
      const used = await scope.deletions.findRequest(input.requestKey);
      if (used) {
        if (used.operation.id !== id) throw conflict('重新确认请求键已用于其他操作');
        confirmedRequestMatches(used, used.operation.project.id, input); return used.operation;
      }
      const current = await loadDeletion(scope, id, true); assertReconfirmable(current);
      const previous = await scope.deletions.getPlan(current.planId), stored = await scope.deletions.getPlan(input.planId), now = deps.clock.now();
      if (!previous || !stored || stored.plan.operationId !== id || stored.plan.supersedes !== current.operation.confirmationDigest) throw conflict('计划不属于原操作的当前确认');
      if (new Date(stored.plan.expiresAt) <= now) throw conflict('重新确认计划已过期，请重新盘点');
      await scope.deletions.lockProject(current.operation.project.id);
      const target = await deletionScope(deps, current.operation.project.id, scope), fresh = reconfirmationInventory(target, previous.plan, current, reports);
      if (!stored.plan.complete || !fresh.complete) throw precondition('新盘点尚有阻塞，不能接受新清理范围', { blockers: fresh.blockers });
      if (stored.plan.digest !== fresh.digest) throw conflict('重新确认材料又发生变化，请重新盘点');
      const confirmations = current.operation.confirmations ?? [{ planId: current.planId, requestKey: current.requestKey, digest: current.operation.confirmationDigest,
        confirmedBy: current.requestedBy, confirmedAt: current.operation.createdAt }];
      const operation = { ...current.operation, state: 'accepted' as const, confirmationDigest: stored.plan.digest, blockers: [], canRetry: true, updatedAt: now.toISOString(),
        confirmations: [...confirmations, { planId: input.planId, requestKey: input.requestKey, digest: stored.plan.digest, confirmedBy: actor.userId, confirmedAt: now.toISOString() }] };
      const { leaseOwner: _owner, leaseUntil: _until, ...rest } = current;
      await scope.deletions.saveOperation({ ...rest, planId: input.planId, generation: current.generation + 1, operation });
      await scope.events.publish(DomainTopic.projectDeletionRequested, { projectId: operation.project.id, operationId: id, occurredAt: now.toISOString() }); return operation;
    })),
  };
}
