import type { ProjectId, TaskId } from '@crewstation/contracts';
import type { EnvironmentState, TaskEnvironment } from '../domain/taskEnvironment';

export interface EnvironmentRepository {
  insert(env: TaskEnvironment): Promise<void>;
  update(env: TaskEnvironment): Promise<void>;
  getById(id: TaskId): Promise<TaskEnvironment | undefined>;
  listByProject(projectId: ProjectId, states?: EnvironmentState[]): Promise<TaskEnvironment[]>;
  listByStates(states: EnvironmentState[]): Promise<TaskEnvironment[]>;
  listByTrace(traceId: string): Promise<TaskEnvironment[]>;
  /** 开发会话：一项目同时只允许一个（D46）。 */
  findDevSession(projectId: ProjectId): Promise<TaskEnvironment | undefined>;
}

/** 配额准入表：一行一项目，UPDATE … WHERE running < limit 原子判定（AT-19、AT-39）。 */
export interface AdmissionRepository {
  tryAcquire(projectId: ProjectId, limit: number): Promise<boolean>;
  release(projectId: ProjectId): Promise<void>;
  running(projectId: ProjectId): Promise<number>;
}
