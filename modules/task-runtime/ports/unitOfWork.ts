import type { DomainPayload, DomainTopicName, TaskId } from '@crewstation/contracts';
import type { TaskEnvironment } from '../domain/taskEnvironment';
import type { LedgerRecordRef } from './ledger';
import type { AdmissionRepository, EnvironmentRepository } from './repositories';
import type { RebuildQueue, RebuildRepository } from './rebuilds';

export interface DomainEventPublisher {
  publish<T extends DomainTopicName>(topic: T, payload: DomainPayload<T>): Promise<void>;
}

/**
 * 项目并发额度（D31、RFC-006）。配了资源台账（RFC-025）时由台账在同一事务里受理：按阶段数，结束中仍占，阶段离开就自然回来，
 * 释放不需要做减法；没配台账时（用例、独立部署）用本模块的计数器。调用方已持有项目行锁（admissions.lock）。
 */
export interface TaskQuota {
  /** 受理一个要占额度的环境（传要落库的那个状态）：够就占上，不够抛 quota_exceeded，文案用调用方给的。 */
  acquire(env: TaskEnvironment, limit: number, message: string): Promise<void>;
  /** 环境不再占额度（释放完、暂停、失败）：台账按阶段自己算，计数器减一。 */
  release(env: TaskEnvironment): Promise<void>;
  /** 项目眼下占用的额度单位。 */
  running(projectId: TaskEnvironment['projectId']): Promise<number>;
}

export interface RepositoryScope {
  readonly environments: EnvironmentRepository;
  /** 项目行锁（串行化同一项目的创建、释放、恢复）与旧的额度计数器；额度经 quota。 */
  readonly admissions: AdmissionRepository;
  readonly quota: TaskQuota;
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
