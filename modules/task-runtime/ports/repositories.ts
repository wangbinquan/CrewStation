import type { ProjectId, TaskId } from '@crewstation/contracts';
import type { EnvironmentState, TaskEnvironment } from '../domain/taskEnvironment';

export interface EnvironmentRepository {
  insert(env: TaskEnvironment): Promise<void>;
  update(env: TaskEnvironment): Promise<void>;
  getById(id: TaskId): Promise<TaskEnvironment | undefined>;
  listByProject(projectId: ProjectId, states?: EnvironmentState[]): Promise<TaskEnvironment[]>;
  listByStates(states: EnvironmentState[], page?: { after?: string; limit: number }): Promise<TaskEnvironment[]>;
  listByTrace(traceId: string): Promise<TaskEnvironment[]>;
  listChildren(parentTaskId: TaskId): Promise<TaskEnvironment[]>;
  pendingExecutions(): Promise<TaskEnvironment[]>;
  /** 开发会话：一项目同时只允许一个（D46）。 */
  findDevSession(projectId: ProjectId, options?: { includeLatestFailure?: boolean }): Promise<TaskEnvironment | undefined>;
}

export const NATIVE_EXECUTION_JOB_KIND = 'task-runtime.native-execution';

/** 配额准入表：一行一项目，UPDATE … WHERE running < limit 原子判定（AT-19、AT-39）。 */
export interface AdmissionRepository {
  /** 事务内先锁项目，再读会话／变更配额，串行化创建、释放和恢复。 */
  lock(projectId: ProjectId): Promise<void>;
  tryAcquire(projectId: ProjectId, limit: number): Promise<boolean>;
  release(projectId: ProjectId): Promise<void>;
  running(projectId: ProjectId): Promise<number>;
}
