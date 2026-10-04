import { ProjectDeletionSessionDataRequestSchema } from '@crewstation/contracts';
import type { ProjectDeletionContext, ProjectDeletionSessionData, TaskId } from '@crewstation/contracts';
import { jsonHash, newResourceId, precondition } from '@crewstation/kernel';
import type { BusinessExecutionStore } from '../../ports/businessExecutions';
import type { BusinessUsageSourceStore } from '../../ports/businessUsageSources';
import type { DevelopmentUsageSourceStore, DevelopmentUsageStore } from '../../ports/developmentUsage';
import type { SessionDeletionRepository, SessionDeletionSources } from '../../ports/projectDeletion';
import type { SessionProjectWork } from '../../ports/projectWork';

interface Copies {
  business: BusinessExecutionStore; businessSources: BusinessUsageSourceStore;
  development: DevelopmentUsageStore; developmentSources: DevelopmentUsageSourceStore;
}
async function apply(copies: Copies, taskId: TaskId, operation: ProjectDeletionSessionData): Promise<unknown> {
  const { business, development, businessSources, developmentSources } = copies;
  if ('key' in operation && operation.key.executionId !== taskId) throw precondition('私有数字请求的日志不属于原任务');
  switch (operation.type) {
    case 'original-transports': throw precondition('原连接必须从封写范围读取');
    case 'development-lookup': return development.lookup(taskId);
    case 'development-existing': {
      const existing = await development.lookup(taskId);
      if (existing.kind !== 'registered' || operation.registration.runtimeTaskId !== taskId
        || jsonHash(existing.stored.registration) !== jsonHash(operation.registration)) throw precondition('不能在封写后新增或替换开发数字登记');
      return existing.stored;
    }
    case 'development-read': return development.get(taskId, operation.key);
    case 'development-drain': return development.requestDrain(taskId, operation.key, operation.reason);
    case 'development-source': {
      if (!developmentSources.offer) throw precondition('开发原数字页来源尚未装配');
      return developmentSources.offer(operation.key);
    }
    case 'development-source-ack': return developmentSources.acknowledge(operation.key, operation.through);
    case 'development-measurement': return developmentSources.measurement(operation.key, operation.recordId, operation.revision);
    case 'business-read': return business.get(taskId, operation.executionId);
    case 'business-originals': {
      if (!business.originals) throw precondition('原业务执行完整分页来源尚未装配');
      return business.originals(taskId, operation.after);
    }
    case 'business-events': return business.list(taskId, operation.executionId, operation.after, operation.limit);
    case 'business-completion': return business.completionProof(taskId, operation.executionId);
    case 'business-consume': return business.consume(taskId, operation.executionId, operation.through, operation.stopped);
    case 'business-source-ack': return businessSources.acknowledge(taskId, operation.executionId, operation.through);
    case 'business-source': {
      if (!businessSources.offer || !await business.get(taskId, operation.executionId)) throw precondition('业务原数字页来源尚未装配或已经变化');
      return businessSources.offer(taskId, operation.executionId);
    }
    case 'business-measurement': {
      const stored = await business.get(taskId, operation.executionId);
      if (!stored) throw precondition('业务原数字执行已经变化');
      const { executionId, attempt, incarnation, payloadDigest } = stored.receipt;
      return businessSources.measurement({ runtimeTaskId: taskId, executionId, attempt, incarnation, payloadDigest }, operation.recordId, operation.revision);
    }
  }
}
/** PG effects have their own private finally, including reads that must finish before the stop snapshot. */
export function sessionCleanupData(repository: SessionDeletionRepository, sources: SessionDeletionSources, work: SessionProjectWork, copies: Copies) {
  return async (raw: ProjectDeletionContext, rawTaskId: TaskId, requested: ProjectDeletionSessionData): Promise<unknown> => {
    const { context, taskId, operation } = ProjectDeletionSessionDataRequestSchema.parse(structuredClone({ context: raw, taskId: rawTaskId, operation: requested }));
    if (context.phase !== 'stop' || context.confirmed.participant !== 'session') throw precondition('私有数字请求只接受 Session 当前停止许可');
    await sources.assertGrant(context);
    const scope = await repository.scope(context);
    if (!scope.taskKeys.includes(taskId)) throw precondition('私有数字请求的任务不属于原封写范围');
    if (await repository.proof(context)) throw precondition('会话停止阶段已经完成，不能再改变数字副本');
    return work.runGranted(context, { taskKey: taskId, kind: 'cleanup', reference: newResourceId(), inputDigest: jsonHash(operation) },
      (handle) => handle.retain(async () => {
        if (operation.type !== 'original-transports') return apply(copies, taskId, operation);
        const transports = [];
        for (const birth of scope.births) if (birth.taskId === taskId && !await repository.exited(birth))
          transports.push({ id: birth.id, taskId: birth.taskId, replica: birth.replica });
        return transports;
      }));
  };
}
