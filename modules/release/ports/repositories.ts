import type { ReleaseId, ServiceId, SlotName, UserId } from '@crewstation/contracts';
import type { Release } from '../domain/release';
import type { ServiceSlots } from '../domain/slots';

export interface ReleaseRepository {
  insert(release: Release): Promise<void>;
  update(release: Release): Promise<void>;
  getById(id: ReleaseId): Promise<Release | undefined>;
  getByTag(serviceId: ServiceId, tag: string): Promise<Release | undefined>;
  listByService(serviceId: ServiceId, limit: number): Promise<Release[]>;
  findInProgress(serviceId: ServiceId): Promise<Release | undefined>;
}

export interface SlotRepository {
  /** 首次发布建行；遇到已有行不覆盖它的版本、状态或 active 位置。 */
  initialize(slots: ServiceSlots): Promise<void>;
  get(serviceId: ServiceId): Promise<ServiceSlots | undefined>;
  save(slots: ServiceSlots): Promise<void>;
}

export interface TrafficSwitchRecord {
  readonly id: string;
  readonly serviceId: ServiceId;
  readonly fromSlot: SlotName;
  readonly toSlot: SlotName;
  readonly releaseId: ReleaseId;
  readonly previousReleaseId?: ReleaseId;
  readonly actorUserId: UserId;
  readonly reason?: string;
  readonly createdAt: Date;
}

export interface TrafficSwitchRepository {
  insert(record: TrafficSwitchRecord): Promise<void>;
  listByService(serviceId: ServiceId, limit: number): Promise<TrafficSwitchRecord[]>;
}
