import type { Actor, BusinessExecutionTaskQuery, ProjectId, TaskId } from '@crewstation/contracts';
import { BusinessExecutionTaskQuerySchema, BusinessTaskStorageDetailSchema } from '@crewstation/contracts';
import { notFound } from '@crewstation/kernel';
import type { ProjectAuthorizer } from '../../ports/runtime';
import type { FinalizationOperations } from '../../ports/storage/finalizations';
import type { RecoveryQueries } from '../../ports/taskRecovery';
import type { BusinessTaskList } from '../../ports/taskList';

export function projectTaskStorageList(list: BusinessTaskList, authorizer: ProjectAuthorizer) {
  return { listProjectTaskStorage: async (actor: Actor, projectId: ProjectId, query: Omit<BusinessExecutionTaskQuery, 'projectId'>) => {
    await authorizer.authorize(actor, projectId, 'view');
    return list.list({ ...BusinessExecutionTaskQuerySchema.omit({ projectId: true }).parse(query), projectId });
  } };
}

/** Reading progress never advances finalization, renews its lease or makes a physical cleanup request. */
export function taskStorageQueries(tasks: Pick<RecoveryQueries, 'task'>, finalizations: FinalizationOperations, authorizer: ProjectAuthorizer) {
  return {
    describeTaskStorage: async (actor: Actor, taskId: TaskId) => {
      const task = await tasks.task(taskId);
      if (!task) throw notFound('业务任务', taskId);
      const role = await authorizer.authorize(actor, task.intent.projectId, 'view');
      const operation = await finalizations.forTask(task.serviceId, taskId);
      return BusinessTaskStorageDetailSchema.parse({ taskId, projectId: task.intent.projectId, serviceId: task.serviceId,
        completionPolicy: task.intent.task.completionPolicy ?? 'legacy', canOperateStorage: role === 'admin' || role === 'owner', finalization: operation?.view ?? null });
    },
  };
}
