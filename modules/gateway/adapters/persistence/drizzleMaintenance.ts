import type { MaintenanceEventKind, MaintenanceSwitches, ProjectId, ServiceId, UserId } from '@crewstation/contracts';
import { publishDomainEvent } from '@crewstation/eventbus';
import type { Database, Executor } from '@crewstation/persistence';
import { conflict, newResourceId } from '@crewstation/kernel';
import { and, desc, eq, sql } from 'drizzle-orm';
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
    restoreHeld: async (id) => (await db.execute(sql`SELECT 1 FROM gateway.database_restore_maintenance WHERE service_id=${id} AND NOT completed`)).length>0,
    beginRestore: async (input) => {
      await db.execute(sql`SELECT pg_advisory_xact_lock(hashtextextended(${'gateway.maintenance:'+input.serviceId},0))`);
      const [prior]=await db.execute<{operation_id:string;service_id:string;project_id:string;maintenance_revision:number;original:unknown;completed:boolean}>(sql`SELECT * FROM gateway.database_restore_maintenance WHERE operation_id=${input.operationId} OR service_id=${input.serviceId} AND NOT completed FOR UPDATE`);
      if(prior){if(prior.operation_id!==input.operationId||prior.service_id!==input.serviceId||prior.project_id!==input.projectId||prior.completed)throw conflict('维护窗口已归另一操作或原恢复已经结束');return {revision:prior.maintenance_revision,wasOpen:!!prior.original};}
      const [original]=await db.execute<Record<string,unknown>>(sql`SELECT * FROM gateway.service_maintenance WHERE service_id=${input.serviceId} FOR UPDATE`);
      const revision=Number(original?.revision??0)+1;
      await db.execute(sql`INSERT INTO gateway.database_restore_maintenance(operation_id,service_id,project_id,original,maintenance_revision) VALUES(${input.operationId},${input.serviceId},${input.projectId},${original?JSON.stringify(original):null}::jsonb,${revision})`);
      await db.execute(sql`SELECT set_config('crewstation.restore_maintenance',${input.operationId},true)`);
      const body={switches:{users:true,services:true,events:true},allowUserIds:[],reason:'数据库恢复切换 '+input.operationId,startedBy:input.actor,startedAt:input.now.toISOString(),updatedBy:input.actor};
      await db.execute(sql`INSERT INTO gateway.service_maintenance(service_id,project_id,body,revision,updated_at) VALUES(${input.serviceId},${input.projectId},${JSON.stringify(body)}::jsonb,${revision},${input.now.toISOString()}) ON CONFLICT(service_id) DO UPDATE SET body=excluded.body,revision=excluded.revision,updated_at=excluded.updated_at`);
      await db.insert(maintenanceEvents).values({id:newResourceId(),serviceId:input.serviceId,kind:original?'updated':'entered',actorUserId:input.actor,at:input.now,body:{switches:body.switches,allowUserIds:[],reason:body.reason}});
      return {revision,wasOpen:!!original};
    },
    endRestore: async (input) => {
      await db.execute(sql`SELECT pg_advisory_xact_lock(hashtextextended(${'gateway.maintenance:'+input.serviceId},0))`);
      const [hold]=await db.execute<{operation_id:string;service_id:string;original:Record<string,unknown>|null;maintenance_revision:number;completed:boolean}>(sql`SELECT * FROM gateway.database_restore_maintenance WHERE operation_id=${input.operationId} FOR UPDATE`);
      if(!hold||hold.service_id!==input.serviceId||hold.maintenance_revision!==input.revision)throw conflict('原恢复维护保留不匹配');
      if(hold.completed)return;
      const [actual]=await db.execute<{revision:number}>(sql`SELECT revision FROM gateway.service_maintenance WHERE service_id=${input.serviceId} FOR UPDATE`);
      if(actual?.revision!==input.revision)throw conflict('恢复维护窗口已变化');
      await db.execute(sql`SELECT set_config('crewstation.restore_maintenance',${input.operationId},true)`);
      if(hold.original)await db.execute(sql`UPDATE gateway.service_maintenance SET body=${JSON.stringify(hold.original.body)}::jsonb,revision=revision+1,updated_at=now() WHERE service_id=${input.serviceId}`);
      else await db.execute(sql`DELETE FROM gateway.service_maintenance WHERE service_id=${input.serviceId}`);
      const restored=hold.original?.body as MaintenanceBody|undefined;
      await db.insert(maintenanceEvents).values({id:newResourceId(),serviceId:input.serviceId,kind:restored?'updated':'exited',actorUserId:input.actor,at:input.now,body:restored?{switches:restored.switches,allowUserIds:restored.allowUserIds,reason:restored.reason,...(restored.expectedEndAt?{expectedEndAt:restored.expectedEndAt}:{})}:{switches:{users:false,services:false,events:false},allowUserIds:[],reason:'数据库恢复完成 '+input.operationId}});
      await db.execute(sql`UPDATE gateway.database_restore_maintenance SET completed=true WHERE operation_id=${input.operationId}`);
    },
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
