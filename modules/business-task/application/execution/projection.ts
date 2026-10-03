import { executionRunnerTaskId } from '../../domain/executionSubtask';
import { conflict, notFound } from '@crewstation/kernel';
import type { BusinessExecutionApi, BusinessExecutionCaller } from '../../api/executionApi';
import type { TaskId } from '@crewstation/contracts';
import type { BusinessExecutionDeps } from './dependencies';
import { executionSource } from './source';
import { businessExecutionWork } from './deletion/projectWork';

export function executionProjectionUseCases(deps: BusinessExecutionDeps): Pick<BusinessExecutionApi, 'events' | 'output' | 'resolveUsageSource'> & { progressProjection(): Promise<number> } {
  const source = executionSource(deps);
  const owned = async (caller: BusinessExecutionCaller, taskId: TaskId) => {
    const context = await source(caller);
    if (!await deps.operations.forTask(context.serviceId, taskId)) throw notFound('业务任务', taskId);
    return context.serviceId;
  };
  return {
    resolveUsageSource: async (input) => {
      const subtask = await deps.subtasks.forRuntimeExecution(input.runtimeTaskId, input.executionId);
      if (!subtask) return undefined;
      if (subtask.view.attempt !== input.attempt || subtask.incarnation !== input.incarnation || subtask.payloadDigest !== input.payloadDigest)
        throw conflict('数值来源与业务执行代次不一致');
      const parent = await deps.operations.forTask(subtask.serviceId, subtask.taskId);
      if (!parent) return undefined;
      return { projectId: parent.intent.projectId, taskId: subtask.taskId, subtaskId: subtask.view.id,
        executionId: subtask.view.executionId, executionGeneration: subtask.view.attempt };
    },
    events: async (caller, taskId, query) => deps.projection.events(await owned(caller, taskId), taskId, query),
    output: async (caller, taskId, subtaskId) => deps.projection.output(await owned(caller, taskId), taskId, subtaskId),
    progressProjection: async () => {
      const { getBusinessExecution: get, listBusinessExecutionEvents: list } = deps.runner;
      let completed = await deps.projection.expire();
      if (!get || !list) return completed;
      for (const { subtask, sourceSequence } of await deps.projection.pending(20)) {
        try {
          await businessExecutionWork(deps, { serviceId: subtask.serviceId, taskId: subtask.taskId, kind: 'projection', reference: subtask.view.id, revision: { revision: subtask.revision, sourceSequence } }, async (scoped) => {
            const snapshot = await scoped.runner.getBusinessExecution!(executionRunnerTaskId(subtask), subtask.view.executionId);
            const events = await scoped.runner.listBusinessExecutionEvents!(executionRunnerTaskId(subtask), subtask.view.executionId, sourceSequence, 200);
            // A newer event page may outrun our snapshot. Retry from the saved watermark on the next tick.
            await scoped.projection.append(subtask, snapshot, events.filter((event) => event.sequence <= snapshot.persistedThrough)); completed++;
          });
        } catch { deps.logger.warn('business execution projection awaiting durable source', { subtaskId: subtask.view.id }); }
      }
      if (deps.runner.consumeBusinessExecution) for (const item of await deps.projection.pendingConsumption()) {
        try {
          const subtask = await deps.subtasks.forRuntimeExecution(item.taskId, item.executionId);
          if (!subtask || subtask.view.id !== item.subtaskId) throw notFound('原业务执行', item.subtaskId);
          await businessExecutionWork(deps, { serviceId: subtask.serviceId, taskId: subtask.taskId, kind: 'projection', reference: item.subtaskId, revision: { through: item.through, stopped: item.stopped } }, async (scoped) => {
            await scoped.runner.consumeBusinessExecution!(item.taskId, item.executionId, item.through, item.stopped); await scoped.projection.consumed(item.subtaskId);
          });
        }
        catch { deps.logger.debug('business source consumption acknowledgement deferred', { subtaskId: item.subtaskId }); }
      }
      return completed;
    },
  };
}
