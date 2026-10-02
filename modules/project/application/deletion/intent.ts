import { AcceptProjectDeletionSchema, DomainTopic, ProjectDeletionOperationSchema, ProjectDeletionPlanSchema } from '@crewstation/contracts';
import type { AcceptProjectDeletion, Actor, ProjectDeletionInventory, ProjectId } from '@crewstation/contracts';
import { conflict, newId, notFound, precondition } from '@crewstation/kernel';
import type { DeletionOperationRecord } from '../../domain/deletion/records';
import { deletionInventory } from '../../domain/deletion/inventory';
import { confirmedRequestMatches } from '../../domain/deletion/reconfirmation';
import type { ProjectUseCaseDeps } from '../dependencies';
import { adminDeletionWork, deletionScope, loadDeletion } from './access';

export function deletionIntentUseCases(deps: ProjectUseCaseDeps) {
  return {
    deletionScope: (id: ProjectId) => deletionScope(deps, id),
    prepareDeletionPlan: (actor: Actor, id: ProjectId, reports: readonly ProjectDeletionInventory[]) => adminDeletionWork(deps, actor, () => deps.uow.run(async (scope) => {
      const project = await scope.deletions.lockProject(id);
      if (!project) throw notFound('项目', id);
      if (project.state === 'deleting') throw conflict('项目已受理删除，请查看原清理操作', { operationId: (await scope.deletions.findOperation(id))?.operation.id });
      const target = await deletionScope(deps, id, scope), now = deps.clock.now();
      const inventory = deletionInventory(target, reports);
      const plan = ProjectDeletionPlanSchema.parse({ id: newId('pdp'), target, ...inventory, expiresAt: new Date(now.getTime() + 600_000).toISOString() });
      await scope.deletions.insertPlan({ plan, requestedBy: actor.userId, createdAt: now }); return plan;
    })),
    acceptProjectDeletion: (actor: Actor, id: ProjectId, request: AcceptProjectDeletion, reports: readonly ProjectDeletionInventory[]) => adminDeletionWork(deps, actor, () => deps.uow.run(async (scope) => {
      const input = AcceptProjectDeletionSchema.parse(request);
      await scope.deletions.lockRequest(input.requestKey);
      const project = await scope.deletions.lockProject(id);
      const previous = await scope.deletions.findRequest(input.requestKey), existing = await scope.deletions.findOperation(id);
      if (previous) {
        confirmedRequestMatches(previous, id, input);
        return previous.operation;
      }
      if (existing) throw conflict('项目已有清理操作，不能再次受理', { operationId: existing.operation.id });
      if (!project) throw notFound('项目', id);
      const stored = await scope.deletions.getPlan(input.planId), now = deps.clock.now();
      if (!stored || stored.plan.target.id !== id || stored.plan.operationId) throw conflict('删除计划不属于当前项目的首次确认');
      if (new Date(stored.plan.expiresAt) <= now) throw conflict('删除计划已过期，请重新盘点并确认');
      const current = deletionInventory(await deletionScope(deps, id, scope), reports);
      if (!stored.plan.complete || !current.complete) throw precondition('删除盘点尚有阻塞，不能销毁项目', { blockers: current.blockers });
      if (stored.plan.digest !== current.digest) throw conflict('项目或资源盘点已改变，请重新确认');
      const operation = ProjectDeletionOperationSchema.parse({ id: newId('pdo'), project: { id, slug: project.slug, name: project.name }, state: 'accepted', phase: 'seal',
        confirmationDigest: stored.plan.digest, receipts: [], blockers: [], canRetry: true, createdAt: now.toISOString(), updatedAt: now.toISOString() });
      await scope.deletions.insertOperation({ operation, planId: input.planId, requestKey: input.requestKey, requestedBy: actor.userId, generation: 0 });
      await scope.deletions.markDeleting(id, now);
      await scope.events.publish(DomainTopic.projectDeletionRequested, { projectId: id, operationId: operation.id, occurredAt: now.toISOString() }); return operation;
    })),
    readProjectDeletion: (actor: Actor, id: string) => adminDeletionWork(deps, actor, async () => (await loadDeletion(deps.uow.read, id)).operation),
    findProjectDeletion: (actor: Actor, id: ProjectId) => adminDeletionWork(deps, actor, async () => (await deps.uow.read.deletions.findOperation(id))?.operation),
    replayProjectDeletion: (actor: Actor, id: ProjectId, raw: AcceptProjectDeletion) => adminDeletionWork(deps, actor, async () => {
      const input = AcceptProjectDeletionSchema.parse(raw), previous = await deps.uow.read.deletions.findRequest(input.requestKey);
      if (!previous) {
        const existing = await deps.uow.read.deletions.findOperation(id);
        if (existing) throw conflict('项目已有清理操作，不能再次受理', { operationId: existing.operation.id });
        return undefined;
      }
      confirmedRequestMatches(previous, id, input);
      return previous.operation;
    }),
    retryProjectDeletion: (actor: Actor, id: string) => adminDeletionWork(deps, actor, () => deps.uow.run(async (scope) => {
      const current = await loadDeletion(scope, id, true);
      if (current.operation.state === 'succeeded' || current.operation.state === 'running') return current.operation;
      const now = deps.clock.now();
      const { leaseOwner: _owner, leaseUntil: _until, ...rest } = current;
      const next: DeletionOperationRecord = { ...rest, generation: current.generation + 1, operation: { ...current.operation, state: 'accepted', blockers: [], canRetry: true, updatedAt: now.toISOString() } };
      await scope.deletions.saveOperation(next);
      await scope.events.publish(DomainTopic.projectDeletionRequested, { projectId: current.operation.project.id, operationId: id, occurredAt: now.toISOString() }); return next.operation;
    })),
    assertProjectAvailable: async (id: ProjectId) => {
      const project = await deps.uow.read.projects.getById(id);
      if (!project) throw notFound('项目', id);
      if (project.state === 'deleting') throw precondition('项目正在永久删除，不能继续写入或新增资源', { projectId: id });
    },
    inspectProjectDeletionMetadata: (id: ProjectId) => deps.uow.read.deletions.inspectMetadata(id),
  };
}
