import type { DomainPayload, DomainTopicName, TaskId } from '@crewstation/contracts';
import type { TaskEnvironment } from '../domain/taskEnvironment';
import type { LedgerRecordRef } from './ledger';
import type { AdmissionRepository, EnvironmentRepository } from './repositories';
import type { RebuildQueue, RebuildRepository } from './rebuilds';

export interface DomainEventPublisher {
  publish<T extends DomainTopicName>(topic: T, payload: DomainPayload<T>): Promise<void>;
}

export interface RepositoryScope {
  readonly environments: EnvironmentRepository;
  readonly admissions: AdmissionRepository;
  readonly events: DomainEventPublisher;
  readonly rebuilds: RebuildRepository;
  readonly rebuildQueue: RebuildQueue;
  readonly nativeQueue: { enqueue(taskId: TaskId): Promise<void> };
  /**
   * 配了资源台账（RFC-025）时：sync 在当前事务里把一个环境投影进台账（环境落库时仓储已自动投影，补投影才直接调它）；
   * workload 读这个环境的工作负载记录（资源中心可能已替它改了期望：失败保留期满）。
   */
  readonly ledger?: { sync(env: TaskEnvironment): Promise<void>; workload(env: TaskEnvironment): Promise<LedgerRecordRef | undefined> };
}

export interface UnitOfWork {
  readonly read: RepositoryScope;
  run<T>(fn: (scope: RepositoryScope) => Promise<T>): Promise<T>;
}
