import type { SlotMaintenance, ClusterSlotProjection } from '../domain/slotMaintenance';
import type { ReleaseId, ServiceId, SlotEventKind, SlotName, UserId } from '@crewstation/contracts';
import type { Release } from '../domain/release';
import type { OfflinePolicy } from '../domain/slotLifecycle';
import type { OfflineReason, ServiceSlots } from '../domain/slots';

export interface ReleaseRepository {
  insert(release: Release): Promise<void>;
  update(release: Release): Promise<void>;
  getById(id: ReleaseId): Promise<Release | undefined>;
  getByTag(serviceId: ServiceId, tag: string): Promise<Release | undefined>;
  listByService(serviceId: ServiceId, limit: number): Promise<Release[]>;
  findInProgress(serviceId: ServiceId): Promise<Release | undefined>;
  /** 只改这一次部署实际用上的生产配置版本（T8：环境在建 Secret 时才渲染），不动发布的其他字段——流水线同时在写它的状态。 */
  recordConfigVersion(id: ReleaseId, configVersion: number): Promise<void>;
}

export interface SlotRepository {
  /** 首次发布建行；遇到已有行不覆盖它的版本、状态或 active 位置。 */
  initialize(slots: ServiceSlots): Promise<void>;
  get(serviceId: ServiceId): Promise<ServiceSlots | undefined>;
  save(slots: ServiceSlots): Promise<void>;
  /** 全部服务的槽（不加锁），供自动下线巡检；写入前逐个在事务里重新 `get` 加锁。 */
  list(): Promise<ServiceSlots[]>;
}

/** RFC-021：待命槽的下线、重新部署、推迟与提醒记录。 */
export interface SlotEventRecord {
  readonly id: string;
  readonly serviceId: ServiceId;
  readonly kind: SlotEventKind;
  readonly releaseId: ReleaseId;
  readonly tag: string;
  readonly reason?: OfflineReason;
  readonly actorUserId?: UserId;
  readonly deadline?: Date;
  readonly at: Date;
}

export interface SlotEventRepository {
  insert(record: SlotEventRecord): Promise<void>;
  listByService(serviceId: ServiceId, limit: number): Promise<SlotEventRecord[]>;
}

export interface OfflinePolicyRecord extends OfflinePolicy {
  readonly revision: number;
  readonly updatedBy?: UserId;
  readonly updatedAt?: Date;
}

/** 平台统一的自动下线时长（单行）；没有记录时由用例取默认值。 */
export interface OfflinePolicyRepository {
  get(): Promise<OfflinePolicyRecord | undefined>;
  /** 只在库里的版本号仍是 `expectedRevision` 时写入（首次写入时为 0）；返回是否写入。 */
  save(record: OfflinePolicyRecord & { updatedAt: Date }, expectedRevision: number): Promise<boolean>;
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

export interface MaintenanceRepository {
  get(id: string): Promise<SlotMaintenance | undefined>;
  save(record: SlotMaintenance): Promise<void>;
  active(serviceId: string): Promise<SlotMaintenance | undefined>;
  override(serviceId: string, physical: string): Promise<number | undefined>;
  setOverride(serviceId: string, physical: string, replicas?: number): Promise<void>;
  projection(serviceId?: string): Promise<ClusterSlotProjection[]>;
}
