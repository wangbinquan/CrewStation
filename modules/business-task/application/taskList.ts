import type { Actor, BusinessExecutionTaskQuery } from '@crewstation/contracts';
import { BusinessExecutionTaskQuerySchema } from '@crewstation/contracts';
import { forbidden } from '@crewstation/kernel';
import type { BusinessTaskList } from '../ports/taskList';
export function taskListUseCases(repository: BusinessTaskList) {
  return { listExecutionTasks: async (actor: Actor, query: BusinessExecutionTaskQuery) => {
    if (!actor.isAdmin) throw forbidden('任务执行列表仅供平台管理员');
    return repository.list(BusinessExecutionTaskQuerySchema.parse(query));
  } };
}
