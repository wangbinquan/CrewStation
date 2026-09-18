import type { SubtaskRun } from '../domain/subtaskRun';
import type { BusinessTaskUseCaseDeps } from './dependencies';

type Step = (run: SubtaskRun) => Promise<SubtaskRun>;

/**
 * 工作器：推进仍在运行的子任务，避免只靠业务轮询；补派等子 Runner 的子任务（连接回调丢失时接续），
 * 执行环境失败的子任务按失败收尾；已结束子任务的执行环境回收回执丢失时重试（RFC-006）。
 */
export function subtaskSweep(deps: Pick<BusinessTaskUseCaseDeps, 'uow'>, steps: { refresh: Step; launch: Step; releaseExecution: Step }) {
  return async (): Promise<number> => {
    let n = 0;
    for (const run of await deps.uow.read.subtasks.listActive(200)) { const next = await steps.refresh(run); if (next !== run) n += 1; }
    for (const run of await deps.uow.read.subtasks.listPendingExecutions(100)) { const next = await steps.launch(run); if (next.state !== run.state) n += 1; }
    for (const run of await deps.uow.read.subtasks.listUnreleasedExecutions(100)) await steps.releaseExecution(run);
    return n;
  };
}
