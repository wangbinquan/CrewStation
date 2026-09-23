import type { AllowlistDocument, DomainPayload, DomainTopicName, MaintenanceEventKind, MaintenanceSwitches, RouteEntry, ServiceId, UserId } from '@crewstation/contracts';
import type { Maintenance } from '../domain/maintenance';
import type { PodIdentityRecord } from '../domain/podIdentity';

export interface AllowlistRepository {
  latest(): Promise<AllowlistDocument | undefined>;
  save(doc: AllowlistDocument): Promise<void>;
}

export interface PodIdentityRepository {
  upsert(record: Omit<PodIdentityRecord, 'version'>): Promise<PodIdentityRecord>;
  markDeleted(podName: string, namespace: string, at: Date): Promise<void>;
  /** 全量重列之后：`before` 以来没被刷新过的在册行都是已经不在的 Pod，标为删除；返回条数。 */
  pruneStale(before: Date, at: Date): Promise<number>;
  /** 删掉 `before` 之前就已标为删除的行（墓碑过了保留期）；返回条数。 */
  purgeTombstones(before: Date): Promise<number>;
  byIp(ip: string): Promise<PodIdentityRecord | undefined>;
  listActive(): Promise<PodIdentityRecord[]>;
}

/** RFC-021：维护的一条记录（进入、调整、退出），带当时的开关、原因、预计恢复时间与临时指定的人。 */
export interface MaintenanceEventRecord {
  readonly id: string;
  readonly serviceId: ServiceId;
  readonly kind: MaintenanceEventKind;
  readonly actorUserId: UserId;
  readonly at: Date;
  readonly switches: MaintenanceSwitches;
  readonly reason: string;
  readonly expectedEndAt?: Date;
  readonly allowUserIds: readonly UserId[];
}

/** 正式版本维护：写入都带版本条件，两个人同时改只有一个成功。 */
export interface MaintenanceRepository {
  get(serviceId: ServiceId): Promise<Maintenance | undefined>;
  listActive(): Promise<Maintenance[]>;
  /** 仅当库里版本号仍是 `expectedRevision`（不在维护中为 0）时写入；返回是否写入。 */
  save(maintenance: Maintenance, expectedRevision: number): Promise<boolean>;
  /** 仅当库里版本号仍是 `expectedRevision` 时删除；返回是否删除。 */
  remove(serviceId: ServiceId, expectedRevision: number): Promise<boolean>;
  insertEvent(event: MaintenanceEventRecord): Promise<void>;
  listEvents(serviceId: ServiceId, limit: number): Promise<MaintenanceEventRecord[]>;
}

export interface MaintenanceScope {
  readonly maintenance: MaintenanceRepository;
  publish<T extends DomainTopicName>(topic: T, payload: DomainPayload<T>): Promise<void>;
}

/** 维护的写入与领域事件在同一事务里（outbox）。 */
export interface MaintenanceUnitOfWork {
  readonly read: MaintenanceScope;
  run<T>(fn: (scope: MaintenanceScope) => Promise<T>): Promise<T>;
}

export interface RouteRepository {
  saveForService(serviceId: string, serviceName: string, routes: RouteEntry[]): Promise<void>;
  listAll(): Promise<Array<{ serviceId: string; serviceName: string; routes: RouteEntry[] }>>;
}

/** 一行限流策略：平台默认的 body 是整套限流，项目覆盖的 body 是覆盖的那几项（读出来由用例按契约校验）。 */
export interface RateLimitRow {
  readonly scope: string;
  readonly body: unknown;
  readonly revision: number;
  readonly updatedAt: Date;
  readonly updatedBy: UserId;
}

/** RFC-025 T10：限流策略的存取，按版本号乐观并发（expectedRevision 为 0 表示还没有这一行）。 */
export interface RateLimitRepository {
  get(scope: string): Promise<RateLimitRow | undefined>;
  list(): Promise<RateLimitRow[]>;
  /** 写成返回新的一行；版本号对不上（别人先改过）返回 undefined。 */
  save(scope: string, body: unknown, expectedRevision: number, at: Date, by: UserId): Promise<RateLimitRow | undefined>;
  /** 按版本号删（撤掉项目覆盖）；对不上返回 false。 */
  remove(scope: string, expectedRevision: number): Promise<boolean>;
}
