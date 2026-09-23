import type { ProjectId, TaskId } from '@crewstation/contracts';
import type { TraceBusinessTaskDto } from '../api/moduleApi';
import type { BusinessTaskUseCaseDeps } from './dependencies';
import { subtaskToDto } from './toDto';

/**
 * 调用链回放（Design §14）的内部读取，调用方已按项目校验过可见性：这些 traceId 在本项目里的业务任务，
 * 连同每个子任务的每次尝试、上一次尝试与各自的执行环境。
 */
export function traceTaskQueries({ uow }: BusinessTaskUseCaseDeps) {
  return {
    listTraceTasks: async (projectId: ProjectId, traceIds: readonly string[]): Promise<TraceBusinessTaskDto[]> => {
      const tasks = await uow.read.tasks.listByProjectTraces(projectId, traceIds);
      const runs = await uow.read.subtasks.listByTasks(tasks.map((task) => task.id));
      const byTask = new Map<TaskId, TraceBusinessTaskDto['subtasks']>();
      for (const run of runs) {
        const list = byTask.get(run.taskId) ?? [];
        list.push({ ...subtaskToDto(run), createdAt: run.createdAt.toISOString(), ...(run.retry ? { retryOf: run.retry.previousId } : {}), ...(run.execution ? { executionTaskId: run.execution.taskId } : {}) });
        byTask.set(run.taskId, list);
      }
      return tasks.map((task) => ({
        id: task.id, traceId: task.traceId, state: task.state, callerIdentity: task.callerIdentity, createdAt: task.createdAt.toISOString(), updatedAt: task.updatedAt.toISOString(),
        ...(task.closedAt ? { closedAt: task.closedAt.toISOString() } : {}), subtasks: byTask.get(task.id) ?? [],
      }));
    },
  };
}
