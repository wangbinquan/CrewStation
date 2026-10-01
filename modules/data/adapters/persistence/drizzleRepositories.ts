import type { DataEnv, DataResourceKind, DataResourceState, ProjectId, ServiceId, TaskDataBindingState, TaskDataMode, TaskId, UserId } from '@crewstation/contracts';
import type { Database, Executor, Transaction } from '@crewstation/persistence';
import { and, eq, inArray, lt, sql } from 'drizzle-orm';
import type { DataResource } from '../../domain/dataResource';
import type { TaskDataBinding } from '../../domain/taskDataBinding';
import type { DataResourceRepository, NativePostgresHistoryStore, TaskDataBindingRepository } from '../../ports/repositories';
import { resources, taskBindings } from './tables';

const opt = <T>(v: T | null): { [k: string]: T } | Record<string, never> => (v === null ? {} : { value: v });

export function drizzleDataResourceRepository(db: Executor): DataResourceRepository {
  const toResource = (r: typeof resources.$inferSelect): DataResource => ({
    id: r.id, projectId: r.projectId as ProjectId, serviceId: r.serviceId as ServiceId, kind: r.kind as DataResourceKind, env: r.env as DataEnv, plan: r.plan,
    state: r.state as DataResourceState, envVar: r.envVar, objectName: r.objectName, ...(r.secretBox ? { secretBox: r.secretBox } : {}), ...(r.message ? { message: r.message } : {}),
    createdAt: r.createdAt, updatedAt: r.updatedAt,
  });
  const toRow = (r: DataResource): typeof resources.$inferInsert => ({ ...r, secretBox: r.secretBox ?? null, message: r.message ?? null });
  return {
    insert: async (r) => { await db.insert(resources).values(toRow(r)); },
    update: async (r) => { await db.update(resources).set(toRow(r)).where(eq(resources.id, r.id)); },
    getById: async (id) => { const row = (await db.select().from(resources).where(eq(resources.id, id)))[0]; return row ? toResource(row) : undefined; },
    find: async (serviceId, env, kind) => { const row = (await db.select().from(resources).where(and(eq(resources.serviceId, serviceId), eq(resources.env, env), eq(resources.kind, kind))))[0]; return row ? toResource(row) : undefined; },
    listByService: async (serviceId) => (await db.select().from(resources).where(eq(resources.serviceId, serviceId))).map(toResource),
    listByProject: async (projectId) => (await db.select().from(resources).where(eq(resources.projectId, projectId))).map(toResource),
    listAll: async () => (await db.select().from(resources).orderBy(resources.createdAt)).map(toResource),
  };
}

export function drizzleTaskBindingRepository(db: Executor): TaskDataBindingRepository {
  const toBinding = (r: typeof taskBindings.$inferSelect): TaskDataBinding => ({
    ...(r.legacyResourceId ? { legacyResourceId: r.legacyResourceId } : {}),
    id: r.id, taskId: r.taskId as TaskId, serviceId: r.serviceId, projectId: r.projectId, mode: r.mode as TaskDataMode, state: r.state as TaskDataBindingState,
    ...(r.reason ? { reason: r.reason } : {}), ...(r.decision ? { decision: r.decision } : {}), requestedBy: r.requestedBy as UserId, ...(r.decidedBy ? { decidedBy: r.decidedBy as UserId } : {}),
    ttlMinutes: r.ttlMinutes, ...(r.expiresAt ? { expiresAt: r.expiresAt } : {}), ...(r.roleName ? { roleName: r.roleName } : {}), ...(r.secretBox ? { secretBox: r.secretBox } : {}),
    createdAt: r.createdAt, updatedAt: r.updatedAt,
  });
  const toRow = (b: TaskDataBinding): typeof taskBindings.$inferInsert => ({
    ...b, reason: b.reason ?? null, decision: b.decision ?? null, decidedBy: b.decidedBy ?? null, expiresAt: b.expiresAt ?? null, roleName: b.roleName ?? null, secretBox: b.secretBox ?? null,
  });
  return {
    insert: async (b) => { await db.insert(taskBindings).values(toRow(b)); },
    update: async (b) => { await db.update(taskBindings).set(toRow(b)).where(eq(taskBindings.id, b.id)); },
    getById: async (id) => { const row = (await db.select().from(taskBindings).where(eq(taskBindings.id, id)))[0]; return row ? toBinding(row) : undefined; },
    listByTask: async (taskId) => (await db.select().from(taskBindings).where(eq(taskBindings.taskId, taskId)).orderBy(taskBindings.createdAt)).map(toBinding),
    listByProject: async (projectId, states) => (await db.select().from(taskBindings).where(states?.length ? and(eq(taskBindings.projectId, projectId), inArray(taskBindings.state, states)) : eq(taskBindings.projectId, projectId)).orderBy(taskBindings.createdAt)).map(toBinding),
    listExpired: async (now) => (await db.select().from(taskBindings).where(and(eq(taskBindings.state, 'active'), lt(taskBindings.expiresAt, now)))).map(toBinding),
    listOpen: async () => (await db.select().from(taskBindings).where(inArray(taskBindings.state, ['requested', 'approved', 'active'])).orderBy(taskBindings.createdAt)).map(toBinding),
  };
}

void opt;

type NativeSnapshot = Awaited<ReturnType<NativePostgresHistoryStore['read']>>;
type NativeResourceRow = NativeSnapshot['resources'][number];
type NativeBindingRow = NativeSnapshot['bindings'][number];
type SqlDates<T> = Omit<T, 'createdAt' | 'updatedAt' | 'expiresAt'> & { createdAt: string; updatedAt: string; expiresAt?: string | null };

async function nativeHistoryPages<T extends { id: string } & Record<string, unknown>>(tx: Transaction, select: ReturnType<typeof sql>, projectId: ProjectId, table: 'resources' | 'task_bindings'): Promise<T[]> {
  const out: T[] = [];
  let cursor: string | null = null;
  for (;;) {
    const rows = await tx.execute<T>(sql`SELECT ${select} FROM ${sql.identifier('data')}.${sql.identifier(table)} WHERE project_id=${projectId} AND (${cursor}::text IS NULL OR id>${cursor}) ORDER BY id LIMIT 500`) as T[];
    out.push(...rows);
    if (rows.length < 500) return out;
    cursor = rows[rows.length - 1]!.id;
  }
}

/** BEGIN options precede contextual admission SQL; no SET TRANSACTION after a SELECT. */
export function drizzleNativePostgresHistory(db: Database): NativePostgresHistoryStore {
  return { read: (projectId) => db.transaction(async (tx) => {
    const common = sql`id,project_id AS "projectId",service_id AS "serviceId",state,secret_box AS "secretBox",created_at AS "createdAt",updated_at AS "updatedAt"`;
    const resourceRows = await nativeHistoryPages<SqlDates<NativeResourceRow>>(tx, sql`${common},kind,env,object_name AS "objectName"`, projectId, 'resources');
    const bindingRows = await nativeHistoryPages<SqlDates<NativeBindingRow>>(tx, sql`${common},task_id AS "taskId",legacy_resource_id AS "legacyResourceId",mode,role_name AS "roleName",expires_at AS "expiresAt"`, projectId, 'task_bindings');
    return {
      resources: resourceRows.map((row) => ({ ...row, createdAt: new Date(row.createdAt), updatedAt: new Date(row.updatedAt) })),
      bindings: bindingRows.map((row) => ({ ...row, createdAt: new Date(row.createdAt), updatedAt: new Date(row.updatedAt), expiresAt: row.expiresAt === null ? null : new Date(row.expiresAt!) })),
    };
  }, { isolationLevel: 'repeatable read', accessMode: 'read only' }) };
}
