import type { MaintenanceEventKind, MaintenanceSwitches, ProjectId, ServiceId, UserId } from '@crewstation/contracts';
import { publishDomainEvent } from '@crewstation/eventbus';
import type { Database, Executor } from '@crewstation/persistence';
import { and, desc, eq } from 'drizzle-orm';
import type { Maintenance } from '../../domain/maintenance';
import type { MaintenanceEventRecord, MaintenanceRepository, MaintenanceScope, MaintenanceUnitOfWork } from '../../ports/repositories';
import { maintenanceEvents, serviceMaintenance } from './tables';

interface MaintenanceBody {
  switches: MaintenanceSwitches;
  allowUserIds: string[];
  reason: string;
  expectedEndAt?: string;
  startedBy: string;
  startedAt: string;
  updatedBy: string;
}

interface EventBody { switches: MaintenanceSwitches; allowUserIds: string[]; reason: string; expectedEndAt?: string }

const json = <T>(v: unknown): T => (typeof v === 'string' ? JSON.parse(v) : v) as T;

function toMaintenance(row: typeof serviceMaintenance.$inferSelect): Maintenance {
  const body = json<MaintenanceBody>(row.body);
  return {
    serviceId: row.serviceId as ServiceId, projectId: row.projectId as ProjectId, switches: body.switches, allowUserIds: body.allowUserIds as UserId[], reason: body.reason,
    ...(body.expectedEndAt ? { expectedEndAt: new Date(body.expectedEndAt) } : {}),
    startedBy: body.startedBy as UserId, startedAt: new Date(body.startedAt), updatedBy: body.updatedBy as UserId, updatedAt: row.updatedAt, revision: row.revision,
  };
}

function toBody(m: Maintenance): MaintenanceBody {
  return { switches: m.switches, allowUserIds: [...m.allowUserIds], reason: m.reason, ...(m.expectedEndAt ? { expectedEndAt: m.expectedEndAt.toISOString() } : {}), startedBy: m.startedBy, startedAt: m.startedAt.toISOString(), updatedBy: m.updatedBy };
}

export function drizzleMaintenanceRepository(db: Executor): MaintenanceRepository {
  return {
    get: async (serviceId) => {
      const row = (await db.select().from(serviceMaintenance).where(eq(serviceMaintenance.serviceId, serviceId)))[0];
      return row ? toMaintenance(row) : undefined;
    },
    listActive: async () => (await db.select().from(serviceMaintenance)).map(toMaintenance),
    // 进入只在没有这一行时插入；调整只在版本号仍一致时更新——不会把别人刚退出的维护又写回来。
    save: async (m, expectedRevision) => {
      const values = { serviceId: m.serviceId, projectId: m.projectId, body: toBody(m), revision: m.revision, updatedAt: m.updatedAt };
      const rows = expectedRevision === 0
        ? await db.insert(serviceMaintenance).values(values).onConflictDoNothing({ target: serviceMaintenance.serviceId }).returning({ id: serviceMaintenance.serviceId })
        : await db.update(serviceMaintenance).set(values).where(and(eq(serviceMaintenance.serviceId, m.serviceId), eq(serviceMaintenance.revision, expectedRevision))).returning({ id: serviceMaintenance.serviceId });
      return rows.length === 1;
    },
    remove: async (serviceId, expectedRevision) => (await db.delete(serviceMaintenance).where(and(eq(serviceMaintenance.serviceId, serviceId), eq(serviceMaintenance.revision, expectedRevision))).returning({ id: serviceMaintenance.serviceId })).length === 1,
    insertEvent: async (e) => {
      const body: EventBody = { switches: e.switches, allowUserIds: [...e.allowUserIds], reason: e.reason, ...(e.expectedEndAt ? { expectedEndAt: e.expectedEndAt.toISOString() } : {}) };
      await db.insert(maintenanceEvents).values({ id: e.id, serviceId: e.serviceId, kind: e.kind, actorUserId: e.actorUserId, at: e.at, body });
    },
    // 同一毫秒里的记录按 id（UUIDv7，按生成先后递增）排定先后。
    listEvents: async (serviceId, limit) => (await db.select().from(maintenanceEvents).where(eq(maintenanceEvents.serviceId, serviceId)).orderBy(desc(maintenanceEvents.at), desc(maintenanceEvents.id)).limit(limit)).map((row): MaintenanceEventRecord => {
      const body = json<EventBody>(row.body);
      return { id: row.id, serviceId: row.serviceId as ServiceId, kind: row.kind as MaintenanceEventKind, actorUserId: row.actorUserId as UserId, at: row.at, switches: body.switches, reason: body.reason, ...(body.expectedEndAt ? { expectedEndAt: new Date(body.expectedEndAt) } : {}), allowUserIds: body.allowUserIds as UserId[] };
    }),
  };
}

export function drizzleMaintenanceUnitOfWork(db: Database): MaintenanceUnitOfWork {
  const scope = (executor: Executor): MaintenanceScope => ({
    maintenance: drizzleMaintenanceRepository(executor),
    publish: async (topic, payload) => { await publishDomainEvent(executor, topic, payload); },
  });
  return { read: scope(db), run: (fn) => db.transaction((tx) => fn(scope(tx))) };
}
