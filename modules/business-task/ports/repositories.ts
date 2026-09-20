import type { DomainPayload, DomainTopicName, ProjectId, ServiceId, SubtaskId, TaskId } from '@crewstation/contracts';
import type { BusinessTask } from '../domain/businessTask';
import type { ContractRegistration } from '../domain/contractRegistry';
import type { SubtaskRun } from '../domain/subtaskRun';

export interface TaskRepository {
  insert(task: BusinessTask): Promise<void>;
  update(task: BusinessTask): Promise<void>;
  getById(id: TaskId): Promise<BusinessTask | undefined>;
  listByProject(projectId: ProjectId, limit: number): Promise<BusinessTask[]>;
}

export interface SubtaskRepository {
  findRetry(taskId: TaskId, operationId: string): Promise<SubtaskRun | undefined>;
  reserveRetry(run: SubtaskRun): Promise<{ run: SubtaskRun; created: boolean }>;
  insert(run: SubtaskRun): Promise<void>;
  update(run: SubtaskRun): Promise<void>;
  getById(id: SubtaskId): Promise<SubtaskRun | undefined>;
  listByTask(taskId: TaskId): Promise<SubtaskRun[]>;
  listActive(limit: number): Promise<SubtaskRun[]>;
  /** RFC-006：按子任务执行环境的 taskId 找子任务（子 Runner 连上时派发）。 */
  findByExecution(executionTaskId: TaskId): Promise<SubtaskRun | undefined>;
  /** 已登记执行环境、还在等子 Runner 的 Agent 子任务。 */
  listPendingExecutions(limit: number): Promise<SubtaskRun[]>;
  /** 已结束但执行环境尚未交给 task-runtime 回收的子任务。 */
  listUnreleasedExecutions(limit: number): Promise<SubtaskRun[]>;
}

export interface ContractRepository {
  save(registration: ContractRegistration): Promise<void>;
  latest(serviceId: ServiceId): Promise<ContractRegistration | undefined>;
}

export interface DomainEventPublisher {
  publish<T extends DomainTopicName>(topic: T, payload: DomainPayload<T>): Promise<void>;
}

export interface RepositoryScope {
  readonly tasks: TaskRepository;
  readonly subtasks: SubtaskRepository;
  readonly contracts: ContractRepository;
  readonly events: DomainEventPublisher;
}

export interface UnitOfWork {
  readonly read: RepositoryScope;
  run<T>(fn: (scope: RepositoryScope) => Promise<T>): Promise<T>;
}
