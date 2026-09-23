import type { ProjectId, TaskId } from '@crewstation/contracts';
import type { EnvironmentState, TaskEnvironment } from '../domain/taskEnvironment';

export interface EnvironmentRepository {
  insert(env: TaskEnvironment): Promise<void>;
  update(env: TaskEnvironment): Promise<void>;
  getById(id: TaskId): Promise<TaskEnvironment | undefined>;
  listByProject(projectId: ProjectId, states?: EnvironmentState[]): Promise<TaskEnvironment[]>;
  listByStates(states: EnvironmentState[], page?: { after?: string; limit: number }): Promise<TaskEnvironment[]>;
  /** 调用链列表（Design §14）：本项目开发会话与业务任务按 traceId 分组的时间键，按开始时间倒序翻页。 */
  traceKeys(projectId: ProjectId, page: EnvironmentTracePage): Promise<EnvironmentTraceKey[]>;
  /** since 之后有活动、或仍在进行的链。 */
  activeTraceIds(projectId: ProjectId, since: string): Promise<string[]>;
  /** 这些链在本项目里的全部环境（含各个 Agent 执行），按创建时间正序；不跨项目。 */
  listByProjectTraces(projectId: ProjectId, traceIds: readonly string[]): Promise<TaskEnvironment[]>;
  listChildren(parentTaskId: TaskId): Promise<TaskEnvironment[]>;
  /** RFC-022：启动进度仍在进行中的环境，按 id 翻页。 */
  listStarting(page: { after?: string; limit: number }): Promise<TaskEnvironment[]>;
  pendingExecutions(): Promise<TaskEnvironment[]>;
  /** 开发会话：一项目同时只允许一个（D46）。 */
  findDevSession(projectId: ProjectId, options?: { includeLatestFailure?: boolean }): Promise<TaskEnvironment | undefined>;
}

/** 时间键：firstAt 为毫秒精度的开始时间，before 取上一页最后一条的 (firstAt, traceId)。 */
export interface EnvironmentTraceKey { traceId: string; firstAt: string; lastAt: string; active: boolean }
export interface EnvironmentTracePage { before?: { at: string; traceId: string }; limit: number }

export const NATIVE_EXECUTION_JOB_KIND = 'task-runtime.native-execution';

/** 配额准入表：一行一项目，UPDATE … WHERE running < limit 原子判定（AT-19、AT-39）。 */
export interface AdmissionRepository {
  /** 事务内先锁项目，再读会话／变更配额，串行化创建、释放和恢复。 */
  lock(projectId: ProjectId): Promise<void>;
  tryAcquire(projectId: ProjectId, limit: number): Promise<boolean>;
  release(projectId: ProjectId): Promise<void>;
  running(projectId: ProjectId): Promise<number>;
}
