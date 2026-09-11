import type { ProjectId } from '@crewstation/contracts';

/**
 * 并发任务的实际占用数。计数落在 task-runtime（更高层），project 只声明这个端口，
 * 由组合根在 task-runtime 装配后回填；配额上限与占用数因此仍然同源展示。
 */
export interface TaskUsage {
  runningTasks(projectId: ProjectId): Promise<number>;
}
