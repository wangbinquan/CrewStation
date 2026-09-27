import { executionRunnerTaskId } from '../../domain/executionSubtask';
import { notFound } from '@crewstation/kernel';
import type { BusinessExecutionApi, BusinessExecutionCaller } from '../../api/executionApi';
import type { TaskId } from '@crewstation/contracts';
import type { BusinessExecutionDeps } from './dependencies';
import { executionSource } from './source';

export function executionProjectionUseCases(deps: BusinessExecutionDeps): Pick<BusinessExecutionApi, 'events' | 'output'> & { progressProjection(): Promise<number> } {
  const source = executionSource(deps);
  const owned = async (caller: BusinessExecutionCaller, taskId: TaskId) => {
    const context = await source(caller);
    if (!await deps.operations.forTask(context.serviceId, taskId)) throw notFound('业务任务', taskId);
    return context.serviceId;
  };
  return {
    events: async (caller, taskId, query) => deps.projection.events(await owned(caller, taskId), taskId, query),
    output: async (caller, taskId, subtaskId) => deps.projection.output(await owned(caller, taskId), taskId, subtaskId),
    progressProjection: async () => {
      const { getBusinessExecution: get, listBusinessExecutionEvents: list } = deps.runner;
      let completed = await deps.projection.expire();
      if (!get || !list) return completed;
      for (const { subtask, sourceSequence } of await deps.projection.pending(20)) {
        try {
          const snapshot = await get(executionRunnerTaskId(subtask), subtask.view.executionId);
          const events = await list(executionRunnerTaskId(subtask), subtask.view.executionId, sourceSequence, 200);
          // A newer event page may outrun our snapshot. Retry from the saved watermark on the next tick.
          await deps.projection.append(subtask, snapshot, events.filter((event) => event.sequence <= snapshot.persistedThrough)); completed++;
        } catch { deps.logger.warn('business execution projection awaiting durable source', { subtaskId: subtask.view.id }); }
      }
      if (deps.runner.consumeBusinessExecution) for (const item of await deps.projection.pendingConsumption()) {
        try { await deps.runner.consumeBusinessExecution(item.taskId, item.executionId, item.through, item.stopped); await deps.projection.consumed(item.subtaskId); }
        catch { deps.logger.debug('business source consumption acknowledgement deferred', { subtaskId: item.subtaskId }); }
      }
      return completed;
    },
  };
}
