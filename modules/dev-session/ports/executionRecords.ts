import type { ResourcePhase, TaskId } from '@crewstation/contracts';

/**
 * 由组合根接到资源中心（RFC-025 §11.2）：一个开发工作区名下各 CLI／Agent 执行记录的阶段，键是执行环境的任务 ID
 * （工作负载记录沿用环境 ID）。读不到就返回空，名册照 Runner 的说法给出。
 */
export interface ExecutionRecords {
  /** 后台观察到的 CLI 界面事实；容器未创建、已释放或非 CLI 的记录不改写。 */
  reportInterface(executionTaskId: TaskId, ready: boolean): Promise<void>;
  phases(workspaceTaskId: TaskId): Promise<ReadonlyMap<string, ResourcePhase>>;
}
