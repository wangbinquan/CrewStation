import type { ServiceSlots } from '../domain/slots';
import type { MaintenanceRepository } from './repositories';
import type { DomainPayload, DomainTopicName } from '@crewstation/contracts';
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
  /** 配了资源台账（RFC-025）时：在当前事务里把一个服务的两个槽投影进台账（保存槽时仓储已自动投影，补投影才直接调它）。 */
  readonly ledger?: { sync(slots: ServiceSlots): Promise<void> };
}

export interface UnitOfWork {
  readonly read: RepositoryScope;
  run<T>(fn: (scope: RepositoryScope) => Promise<T>): Promise<T>;
}
