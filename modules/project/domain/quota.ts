import type { ProjectId } from '@crewstation/contracts';

/** 首版唯一的预算维度：每数字人并发任务配额（R43）；原子准入在 task-runtime 执行。 */
export interface TaskQuota {
  readonly projectId: ProjectId;
  readonly maxConcurrentTasks: number;
}
