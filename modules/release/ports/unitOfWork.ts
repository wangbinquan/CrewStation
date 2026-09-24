import type { PhysicalSlot, ServiceSlots } from '../domain/slots';
import type { JobProjection, JobRecordRef, SlotRecordRef } from './ledger';
import type { MaintenanceRepository } from './repositories';
import type { DomainPayload, DomainTopicName, ServiceId } from '@crewstation/contracts';
import type { OfflinePolicyRepository, ReleaseRepository, SlotEventRepository, SlotRepository, TrafficSwitchRepository } from './repositories';

export interface DomainEventPublisher {
  publish<T extends DomainTopicName>(topic: T, payload: DomainPayload<T>): Promise<void>;
}

export interface RepositoryScope {
  readonly maintenance: MaintenanceRepository;
  readonly releases: ReleaseRepository;
  readonly slots: SlotRepository;
  readonly switches: TrafficSwitchRepository;
  readonly slotEvents: SlotEventRepository;
  readonly offlinePolicy: OfflinePolicyRepository;
  readonly events: DomainEventPublisher;
  /**
   * 配了资源台账（RFC-025）时：sync 在当前事务里把一个服务的两个槽投影进台账（保存槽时仓储已自动投影，补投影才直接调它）；
   * slot 读一个物理槽的台账记录（读不到当作没有）。
   */
  readonly ledger?: {
    sync(slots: ServiceSlots): Promise<void>;
    slot(serviceId: ServiceId, physical: PhysicalSlot): Promise<SlotRecordRef | undefined>;
    /** 构建、迁移 Job 投影进台账（包在保存点里，写失败只告警）。 */
    job(job: JobProjection): Promise<void>;
    /** 读一次发布的构建或迁移 Job 记录（读不到当作没有）；放弃资源中心建的 Job 时报 Failed（T8）。 */
    jobRecord(releaseId: string, kind: JobProjection['kind']): Promise<JobRecordRef | undefined>;
    failJob(releaseId: string, kind: JobProjection['kind'], message: string): Promise<void>;
  };
}

export interface UnitOfWork {
  readonly read: RepositoryScope;
  run<T>(fn: (scope: RepositoryScope) => Promise<T>): Promise<T>;
}
