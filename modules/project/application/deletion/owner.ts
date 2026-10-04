import { ProjectDeletionContextSchema } from '@crewstation/contracts';
import type { ProjectDeletionContext, ProjectDeletionOwner, ProjectDeletionParticipant, ProjectDeletionStepResult } from '@crewstation/contracts';
import { jsonHash, precondition } from '@crewstation/kernel';
import { assertDeletionPhase, nextDeletionPhase } from '../../domain/deletion/progress';
import type { ProjectUseCaseDeps } from '../dependencies';
import { loadDeletion } from './access';
import { deletionProgressUseCases } from './progress';

export function projectDeletionOwnerUseCases(deps: ProjectUseCaseDeps) {
  const assertProjectDeletionGrant = async (raw: ProjectDeletionContext) => {
    const context = ProjectDeletionContextSchema.parse(raw), record = await loadDeletion(deps.uow.read, context.operationId);
    if (record.operation.state !== 'running' || record.generation !== context.generation || !record.leaseUntil || record.leaseUntil <= deps.clock.now()
      || nextDeletionPhase(record.operation) !== context.phase) throw precondition('删除许可已失效或不属于当前阶段');
    assertDeletionPhase(record.operation, context.confirmed.participant, context.phase);
    const stored = await deps.uow.read.deletions.getPlan(record.planId);
    if (!stored || jsonHash(stored.plan.target) !== jsonHash(context.target) ||
      jsonHash(stored.plan.participants.find((p) => p.participant === context.confirmed.participant)) !== jsonHash(context.confirmed)) throw precondition('删除许可与确认材料不符');
  };
  const projectDeletionParticipantContext = async (raw: ProjectDeletionContext, participant: ProjectDeletionParticipant): Promise<ProjectDeletionContext> => {
    const original = ProjectDeletionContextSchema.parse(structuredClone(raw));
    await assertProjectDeletionGrant(original);
    const record = await loadDeletion(deps.uow.read, original.operationId), stored = await deps.uow.read.deletions.getPlan(record.planId);
    const confirmed = stored?.plan.participants.find((entry) => entry.participant === participant);
    if (!stored || !confirmed || !confirmed.complete || confirmed.blockers.length) throw precondition('目标清理参与者缺少原完整确认');
    const context = ProjectDeletionContextSchema.parse(structuredClone({ ...original, target: stored.plan.target, confirmed }));
    await assertProjectDeletionGrant(context);
    return context;
  };
  const progress = deletionProgressUseCases(deps);
  const run = async (context: ProjectDeletionContext): Promise<ProjectDeletionStepResult> => {
    await assertProjectDeletionGrant(context);
    if (context.confirmed.participant !== 'project') throw precondition('清理许可不属于 project');
    const record = await loadDeletion(deps.uow.read, context.operationId), target = await deps.uow.read.projects.getById(context.target.id);
    if (!target || target.state !== 'deleting') throw precondition('项目删除屏障缺失');
    if (context.phase === 'seal' && (await deps.uow.read.deletions.inspectMetadata(target.id)).revision !== context.confirmed.revision) return { kind: 'blocked', blockers: [{ participant: 'project', code: 'inventory-changed', message: '项目内容盘点已改变，需要重新核对清理范围' }] };
    if (context.phase === 'metadata') return { kind: 'done', evidence: await progress.purgeProjectDeletionMetadata({ operationId: context.operationId, owner: record.leaseOwner!, generation: context.generation }) };
    if (context.phase === 'verify' && await deps.uow.read.deletions.metadataCount(target.id) !== 0) return { kind: 'blocked', blockers: [{ participant: 'project', code: 'content-remains', message: '项目本模块仍有内容残留' }] };
    return { kind: 'done', evidence: { kind: ['seal', 'verify'].includes(context.phase) ? 'metadata' : 'not-applicable',
      digest: jsonHash({ projectId: target.id, operationId: context.operationId, phase: context.phase, state: target.state }),
      description: context.phase === 'seal' ? '项目根记录与内容表的持久写入屏障生效' : context.phase === 'verify' ? '本模块内容表已归零；仅保留待最终清理的根记录与最小操作材料' : 'project 模块没有本阶段的物理执行或存储副作用', count: 0 } };
  };
  const deletionOwner: ProjectDeletionOwner = { participant: 'project', inspect: (target) => deps.uow.read.deletions.inspectMetadata(target.id), run };
  return { assertProjectDeletionGrant, projectDeletionParticipantContext, deletionOwner };
}
