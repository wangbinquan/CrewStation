import { ProjectDeletionBlockerSchema, ProjectDeletionEvidenceSchema } from '@crewstation/contracts';
import type { ProjectDeletionBlocker, ProjectDeletionEvidence, ProjectDeletionParticipant, ProjectDeletionPhase } from '@crewstation/contracts';
import { jsonHash, precondition } from '@crewstation/kernel';
import type { DeletionLease, DeletionOperationRecord } from '../../domain/deletion/records';
import { assertDeletionComplete, assertDeletionPhase, nextDeletionPhase } from '../../domain/deletion/progress';
import type { ProjectUseCaseDeps } from '../dependencies';
import { deletionLeaseUntil, leasedDeletion, loadDeletion } from './access';

export function deletionProgressUseCases(deps: ProjectUseCaseDeps) {
  return {
    claimProjectDeletion: (id: string, owner: string, seconds?: number) => deps.uow.run(async (scope) => {
      if (!owner || owner.length > 200) throw precondition('缺少有效的项目删除工作器身份');
      const current = await loadDeletion(scope, id, true), now = deps.clock.now(), leaseUntil = deletionLeaseUntil(now, seconds);
      if (!['accepted', 'running'].includes(current.operation.state) || (current.leaseUntil && current.leaseUntil > now)) return undefined;
      const stored = await scope.deletions.getPlan(current.planId);
      if (!stored || stored.plan.digest !== current.operation.confirmationDigest) throw precondition('原清理计划缺失或摘要不符');
      const next: DeletionOperationRecord = { ...current, generation: current.generation + 1, leaseOwner: owner, leaseUntil,
        operation: { ...current.operation, state: 'running', blockers: [], canRetry: false, updatedAt: now.toISOString() } };
      await scope.deletions.saveOperation(next);
      return { lease: { operationId: id, owner, generation: next.generation }, operation: next.operation, plan: stored.plan };
    }),
    renewProjectDeletion: (lease: DeletionLease, seconds?: number) => deps.uow.run(async (scope) => {
      const now = deps.clock.now(), current = await leasedDeletion(scope, lease, now);
      await scope.deletions.saveOperation({ ...current, leaseUntil: deletionLeaseUntil(now, seconds) });
    }),
    deferProjectDeletion: (lease: DeletionLease, participant: ProjectDeletionParticipant, reason: string) => deps.uow.run(async (scope) => {
      const now = deps.clock.now(), current = await leasedDeletion(scope, lease, now);
      const blocker = ProjectDeletionBlockerSchema.parse({ participant, code: 'waiting-for-proof', message: reason });
      await scope.deletions.saveOperation({ ...current, leaseUntil: deletionLeaseUntil(now, 15), operation: { ...current.operation, blockers: [blocker], updatedAt: now.toISOString() } });
    }),
    recordProjectDeletionReceipt: (lease: DeletionLease, participant: ProjectDeletionParticipant, phase: ProjectDeletionPhase, proof: ProjectDeletionEvidence) => deps.uow.run(async (scope) => {
      const now = deps.clock.now(), current = await leasedDeletion(scope, lease, now), evidence = ProjectDeletionEvidenceSchema.parse(proof);
      assertDeletionPhase(current.operation, participant, phase);
      const previous = current.operation.receipts.find((r) => r.participant === participant && r.phase === phase);
      if (previous) {
        if (jsonHash(previous.evidence) !== jsonHash(evidence)) throw precondition('已完成清理证明不能被不同结果覆盖'); return current.operation;
      }
      const operation = { ...current.operation, updatedAt: now.toISOString(), receipts: [...current.operation.receipts, { participant, phase, evidence, completedAt: now.toISOString(), generation: lease.generation }] };
      operation.phase = nextDeletionPhase(operation); await scope.deletions.saveOperation({ ...current, operation }); return operation;
    }),
    blockProjectDeletion: (lease: DeletionLease, blocked: readonly ProjectDeletionBlocker[]) => deps.uow.run(async (scope) => {
      const now = deps.clock.now(), current = await leasedDeletion(scope, lease, now);
      if (!blocked.length) throw precondition('清理阻塞必须说明原因');
      const blockers = blocked.map((b) => ProjectDeletionBlockerSchema.parse(b));
      const { leaseOwner: _owner, leaseUntil: _until, ...rest } = current;
      const operation = { ...current.operation, state: 'needs-attention' as const, canRetry: true, blockers, updatedAt: now.toISOString() };
      await scope.deletions.saveOperation({ ...rest, operation }); return operation;
    }),
    completeProjectDeletion: (lease: DeletionLease) => deps.uow.run(async (scope) => {
      const now = deps.clock.now(), current = await leasedDeletion(scope, lease, now); assertDeletionComplete(current.operation);
      const project = await scope.deletions.lockProject(current.operation.project.id);
      if (project && project.state !== 'deleting') throw precondition('项目根记录已偏离删除状态，不能标记完成');
      if (await scope.deletions.metadataCount(current.operation.project.id) !== 0) throw precondition('项目本模块仍有内容残留');
      await scope.deletions.finish(current.operation.project.id, current.operation.id);
      const { leaseOwner: _owner, leaseUntil: _until, ...rest } = current;
      const operation = { ...current.operation, state: 'succeeded' as const, canRetry: false, blockers: [], updatedAt: now.toISOString(), completedAt: now.toISOString() };
      await scope.deletions.saveOperation({ ...rest, operation }); return operation;
    }),
    listPendingProjectDeletions: (after?: string, limit?: number) => deps.uow.read.deletions.listPending(deps.clock.now(), after, limit),
    purgeProjectDeletionMetadata: (lease: DeletionLease) => deps.uow.run(async (scope) => {
      const current = await leasedDeletion(scope, lease, deps.clock.now()); assertDeletionPhase(current.operation, 'project', 'metadata');
      const previous = current.operation.receipts.find((r) => r.phase === 'metadata' && r.participant === 'project');
      if (previous) return previous.evidence;
      const stored = await scope.deletions.getPlan(current.planId);
      if (!stored) throw precondition('原删除盘点缺失');
      await scope.deletions.purgeMetadata(current.operation.project.id, current.operation.id);
      if (await scope.deletions.metadataCount(current.operation.project.id) !== 0) throw precondition('项目本模块内容尚未清完');
      const count = stored.plan.participants.find((p) => p.participant === 'project')!.resources.reduce((n, r) => n + r.count, 0);
      return { kind: 'metadata' as const, digest: jsonHash({ operationId: current.operation.id, participant: 'project', remaining: 0 }), description: '项目成员、目录、图标、资源政策与服务记录已清理，根记录留待最终证明', count };
    }),
  };
}
