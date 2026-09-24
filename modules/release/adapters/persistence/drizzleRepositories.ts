import type { Manifest, ProjectId, ReleaseId, ReleaseStatus, ServiceId, SlotEventKind, SlotName, UserId } from '@crewstation/contracts';
import type { Executor } from '@crewstation/persistence';
import { and, desc, eq, inArray } from 'drizzle-orm';
import { IN_PROGRESS, type Release } from '../../domain/release';
import { normalizeLegacySlot } from '../../domain/slotLifecycle';
import type { OfflineReason, PhysicalSlot, ServiceSlots, SlotState } from '../../domain/slots';
import type { OfflinePolicyRepository, ReleaseRepository, SlotEventRecord, SlotEventRepository, SlotRepository, TrafficSwitchRecord, TrafficSwitchRepository } from '../../ports/repositories';
import { offlinePolicy, releases, serviceSlots, slotEvents, trafficSwitches } from './tables';

type ReleaseRow = typeof releases.$inferSelect;

export function drizzleReleaseRepository(db: Executor): ReleaseRepository {
  const first = (rows: ReleaseRow[]): Release | undefined => (rows[0] ? toRelease(rows[0]) : undefined);
  return {
    insert: async (r) => { await db.insert(releases).values(toRow(r)); },
    update: async (r) => { await db.update(releases).set(toRow(r)).where(eq(releases.id, r.id)); },
    getById: (id) => db.select().from(releases).where(eq(releases.id, id)).then(first),
    getByTag: (serviceId, tag) => db.select().from(releases).where(and(eq(releases.serviceId, serviceId), eq(releases.tag, tag))).then(first),
    listByService: async (serviceId, limit) => (await db.select().from(releases).where(eq(releases.serviceId, serviceId)).orderBy(desc(releases.createdAt)).limit(limit)).map(toRelease),
    findInProgress: (serviceId) => db.select().from(releases).where(and(eq(releases.serviceId, serviceId), inArray(releases.status, [...IN_PROGRESS]))).then(first),
    recordConfigVersion: async (id, configVersion) => { await db.update(releases).set({ configVersion }).where(eq(releases.id, id)); },
  };
}

/** 槽 JSON 里的时间都是 ISO 串，读回来逐个还原成 Date。 */
type Stamped<T> = { [K in keyof T]: T[K] extends Date ? string : T[K] extends Date | undefined ? string | undefined : T[K] };
type SlotJson = Stamped<Omit<SlotState, 'retention' | 'offline'>> & { retention?: Stamped<NonNullable<SlotState['retention']>>; offline?: Stamped<NonNullable<SlotState['offline']>> };
const optionalDate = (value: string | undefined): Date | undefined => (value === undefined ? undefined : new Date(value));

export function slotFromJson(raw: unknown, active: boolean): SlotState {
  const { retention, offline, updatedAt, ...rest } = (typeof raw === 'string' ? JSON.parse(raw) : raw) as SlotJson;
  const slot: SlotState = {
    ...rest, updatedAt: new Date(updatedAt),
    ...(retention ? { retention: {
      kind: retention.kind, since: new Date(retention.since), postponements: retention.postponements ?? 0,
      ...Object.fromEntries((['lastAccessAt', 'postponedUntil', 'remindedAt', 'remindedFor'] as const).flatMap((key) => (retention[key] ? [[key, optionalDate(retention[key])]] : []))),
    } } : {}),
    ...(offline ? { offline: { ...offline, at: new Date(offline.at) } } : {}),
  };
  // RFC-010 删除过的旧待命槽读取时归一成「已下线（集群管理）」（RFC-021 design §2）。
  return normalizeLegacySlot(slot, active);
}

function slotsFromRow(row: typeof serviceSlots.$inferSelect): ServiceSlots {
  const active = row.active as PhysicalSlot;
  return { serviceId: row.serviceId as ServiceId, active, blue: slotFromJson(row.blue, active === 'blue'), green: slotFromJson(row.green, active === 'green'), updatedAt: row.updatedAt };
}

export function drizzleSlotRepository(db: Executor, lockForUpdate = false): SlotRepository {
  return {
    initialize: async (s) => { await db.insert(serviceSlots).values(s).onConflictDoNothing({ target: serviceSlots.serviceId }); },
    get: async (serviceId) => {
      const query = db.select().from(serviceSlots).where(eq(serviceSlots.serviceId, serviceId));
      const row = (await (lockForUpdate ? query.for('update') : query))[0];
      return row ? slotsFromRow(row) : undefined;
    },
    list: async () => (await db.select().from(serviceSlots).orderBy(serviceSlots.serviceId)).map(slotsFromRow),
    save: async (s) => {
      const values = { serviceId: s.serviceId, active: s.active, blue: s.blue, green: s.green, updatedAt: s.updatedAt };
      await db.insert(serviceSlots).values(values).onConflictDoUpdate({ target: serviceSlots.serviceId, set: values });
    },
  };
}

export function drizzleTrafficSwitchRepository(db: Executor): TrafficSwitchRepository {
  const toRecord = (row: typeof trafficSwitches.$inferSelect): TrafficSwitchRecord => ({
    id: row.id, serviceId: row.serviceId as ServiceId, fromSlot: row.fromSlot as SlotName, toSlot: row.toSlot as SlotName, releaseId: row.releaseId as ReleaseId,
    ...(row.previousReleaseId ? { previousReleaseId: row.previousReleaseId as ReleaseId } : {}),
    actorUserId: row.actorUserId as UserId, ...(row.reason ? { reason: row.reason } : {}), createdAt: row.createdAt,
  });
  return {
    insert: async (r) => { await db.insert(trafficSwitches).values({ ...r, reason: r.reason ?? null }); },
    listByService: async (serviceId, limit) => (await db.select().from(trafficSwitches).where(eq(trafficSwitches.serviceId, serviceId)).orderBy(desc(trafficSwitches.createdAt)).limit(limit)).map(toRecord),
  };
}

export function drizzleSlotEventRepository(db: Executor): SlotEventRepository {
  const toRecord = (row: typeof slotEvents.$inferSelect): SlotEventRecord => ({
    id: row.id, serviceId: row.serviceId as ServiceId, kind: row.kind as SlotEventKind, releaseId: row.releaseId as ReleaseId, tag: row.tag,
    ...(row.reason ? { reason: row.reason as OfflineReason } : {}), ...(row.actorUserId ? { actorUserId: row.actorUserId as UserId } : {}),
    ...(row.deadline ? { deadline: row.deadline } : {}), at: row.at,
  });
  return {
    insert: async (r) => { await db.insert(slotEvents).values({ ...r, reason: r.reason ?? null, actorUserId: r.actorUserId ?? null, deadline: r.deadline ?? null }); },
    // 同一毫秒里的记录按 id（UUIDv7，按生成先后递增）排定先后，时间线顺序稳定。
    listByService: async (serviceId, limit) => (await db.select().from(slotEvents).where(eq(slotEvents.serviceId, serviceId)).orderBy(desc(slotEvents.at), desc(slotEvents.id)).limit(limit)).map(toRecord),
  };
}

const POLICY_ID = 'platform';

export function drizzleOfflinePolicyRepository(db: Executor): OfflinePolicyRepository {
  return {
    get: async () => {
      const row = (await db.select().from(offlinePolicy).where(eq(offlinePolicy.id, POLICY_ID)))[0];
      return row ? { rollbackRetentionHours: row.rollbackRetentionHours, idleOfflineDays: row.idleOfflineDays, reminderLeadHours: row.reminderLeadHours, revision: row.revision, ...(row.updatedBy ? { updatedBy: row.updatedBy as UserId } : {}), updatedAt: row.updatedAt } : undefined;
    },
    // 条件写入：两位管理员拿着同一版本号同时保存，只有一个成功（首次写入由主键冲突兜底）。
    save: async (r, expectedRevision) => {
      const values = { id: POLICY_ID, rollbackRetentionHours: r.rollbackRetentionHours, idleOfflineDays: r.idleOfflineDays, reminderLeadHours: r.reminderLeadHours, revision: r.revision, updatedBy: r.updatedBy ?? null, updatedAt: r.updatedAt };
      const rows = await db.insert(offlinePolicy).values(values).onConflictDoUpdate({ target: offlinePolicy.id, set: values, setWhere: eq(offlinePolicy.revision, expectedRevision) }).returning({ id: offlinePolicy.id });
      return rows.length === 1;
    },
  };
}

function toRelease(row: ReleaseRow): Release {
  const json = <T>(v: unknown): T => (typeof v === 'string' ? JSON.parse(v) : v) as T;
  return {
    ...(row.legacyResourceId ? { legacyResourceId: row.legacyResourceId } : {}),
    id: row.id as ReleaseId, serviceId: row.serviceId as ServiceId, projectId: row.projectId as ProjectId, tag: row.tag, commitSha: row.commitSha, branch: row.branch,
    status: row.status as ReleaseStatus, targetSlot: row.targetSlot as PhysicalSlot,
    ...(row.image ? { image: row.image } : {}), ...(row.manifest ? { manifest: json<Manifest>(row.manifest) } : {}),
    ...(row.configVersion !== null ? { configVersion: row.configVersion } : {}),
    pipeline: json<Release['pipeline']>(row.pipeline), ...(row.message ? { message: row.message } : {}),
    createdBy: row.createdBy as UserId, createdAt: row.createdAt, updatedAt: row.updatedAt,
  };
}

function toRow(r: Release): typeof releases.$inferInsert {
  return {
    legacyResourceId: r.legacyResourceId ?? null, id: r.id, serviceId: r.serviceId, projectId: r.projectId, tag: r.tag, commitSha: r.commitSha, branch: r.branch, status: r.status, targetSlot: r.targetSlot,
    image: r.image ?? null, manifest: r.manifest ?? null, configVersion: r.configVersion ?? null, pipeline: r.pipeline, message: r.message ?? null,
    createdBy: r.createdBy, createdAt: r.createdAt, updatedAt: r.updatedAt,
  };
}
