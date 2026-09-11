import type { Manifest, ProjectId, ReleaseId, ReleaseStatus, ServiceId, SlotName, UserId } from '@crewstation/contracts';
import type { Executor } from '@crewstation/persistence';
import { and, desc, eq, inArray } from 'drizzle-orm';
import { IN_PROGRESS, type Release } from '../../domain/release';
import type { PhysicalSlot, ServiceSlots, SlotState } from '../../domain/slots';
import type { ReleaseRepository, SlotRepository, TrafficSwitchRecord, TrafficSwitchRepository } from '../../ports/repositories';
import { releases, serviceSlots, trafficSwitches } from './tables';

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
  };
}

export function drizzleSlotRepository(db: Executor): SlotRepository {
  const slot = (raw: unknown): SlotState => {
    const v = (typeof raw === 'string' ? JSON.parse(raw) : raw) as SlotState & { updatedAt: string };
    return { ...v, updatedAt: new Date(v.updatedAt) };
  };
  return {
    get: async (serviceId) => {
      const row = (await db.select().from(serviceSlots).where(eq(serviceSlots.serviceId, serviceId)))[0];
      return row ? { serviceId: row.serviceId as ServiceId, active: row.active as PhysicalSlot, blue: slot(row.blue), green: slot(row.green), updatedAt: row.updatedAt } : undefined;
    },
    save: async (s) => {
      const values = { serviceId: s.serviceId, active: s.active, blue: s.blue, green: s.green, updatedAt: s.updatedAt };
      await db.insert(serviceSlots).values(values).onConflictDoUpdate({ target: serviceSlots.serviceId, set: values });
    },
  };
}

export function drizzleTrafficSwitchRepository(db: Executor): TrafficSwitchRepository {
  const toRecord = (row: typeof trafficSwitches.$inferSelect): TrafficSwitchRecord => ({
    id: row.id, serviceId: row.serviceId as ServiceId, fromSlot: row.fromSlot as SlotName, toSlot: row.toSlot as SlotName, releaseId: row.releaseId as ReleaseId,
    actorUserId: row.actorUserId as UserId, ...(row.reason ? { reason: row.reason } : {}), createdAt: row.createdAt,
  });
  return {
    insert: async (r) => { await db.insert(trafficSwitches).values({ ...r, reason: r.reason ?? null }); },
    listByService: async (serviceId, limit) => (await db.select().from(trafficSwitches).where(eq(trafficSwitches.serviceId, serviceId)).orderBy(desc(trafficSwitches.createdAt)).limit(limit)).map(toRecord),
  };
}

function toRelease(row: ReleaseRow): Release {
  const json = <T>(v: unknown): T => (typeof v === 'string' ? JSON.parse(v) : v) as T;
  return {
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
    id: r.id, serviceId: r.serviceId, projectId: r.projectId, tag: r.tag, commitSha: r.commitSha, branch: r.branch, status: r.status, targetSlot: r.targetSlot,
    image: r.image ?? null, manifest: r.manifest ?? null, configVersion: r.configVersion ?? null, pipeline: r.pipeline, message: r.message ?? null,
    createdBy: r.createdBy, createdAt: r.createdAt, updatedAt: r.updatedAt,
  };
}
