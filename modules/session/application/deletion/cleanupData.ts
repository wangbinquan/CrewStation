import { ProjectDeletionSessionDataRequestSchema } from '@crewstation/contracts';
import type { ProjectDeletionContext, ProjectDeletionSessionData, TaskId } from '@crewstation/contracts';
import { jsonHash, newResourceId, precondition } from '@crewstation/kernel';
import type { SessionCleanupCopies as Copies, SessionCleanupCopySelector } from '../../ports/originalTaskData';
import type { SessionDeletionRepository, SessionDeletionSources } from '../../ports/projectDeletion';
import type { SessionProjectWork } from '../../ports/projectWork';

async function apply(copies: Copies, taskId: TaskId, operation: ProjectDeletionSessionData): Promise<unknown> {
  const { business } = copies;
  switch (operation.type) {
    case 'original-transports': throw precondition('原连接必须从封写范围读取');
    case 'business-read': return business.get(taskId, operation.executionId);
    case 'business-originals': {
      if (!business.originals) throw precondition('原业务执行完整分页来源尚未装配');
      return business.originals(taskId, operation.after);
    }
    case 'business-events': return business.list(taskId, operation.executionId, operation.after, operation.limit);
    case 'business-completion': return business.completionProof(taskId, operation.executionId);
    case 'business-consume': return business.consume(taskId, operation.executionId, operation.through, operation.stopped);
  }
}
/** PG effects have their own private finally, including reads that must finish before the stop snapshot. */
export function sessionCleanupData(repository: SessionDeletionRepository, sources: SessionDeletionSources, work: SessionProjectWork, copies: Copies, select?: SessionCleanupCopySelector) {
  return async (raw: ProjectDeletionContext, rawTaskId: TaskId, requested: ProjectDeletionSessionData): Promise<unknown> => {
    const { context, taskId, operation } = ProjectDeletionSessionDataRequestSchema.parse(structuredClone({ context: raw, taskId: rawTaskId, operation: requested }));
    if (context.phase !== 'stop' || context.confirmed.participant !== 'session') throw precondition('私有数字请求只接受 Session 当前停止许可');
    await sources.assertGrant(context);
    const scope = await repository.scope(context);
    if (!scope.taskKeys.includes(taskId)) throw precondition('私有数字请求的任务不属于原封写范围');
    if (await repository.proof(context)) throw precondition('会话停止阶段已经完成，不能再改变数字副本');
    const selected = operation.type === 'original-transports' || !select ? { taskKey: taskId, copies } : await select(context, scope, taskId);
    return work.runGranted(context, { taskKey: selected.taskKey, kind: 'cleanup', reference: newResourceId(), inputDigest: jsonHash(operation) },
      (handle) => handle.retain(async () => {
        if (operation.type !== 'original-transports') return apply(selected.copies, taskId, operation);
        const transports = [];
        for (const birth of scope.births) if (birth.taskId === taskId && !await repository.exited(birth))
          transports.push({ id: birth.id, taskId: birth.taskId, replica: birth.replica });
        return transports;
      }));
  };
}
