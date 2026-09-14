import type { ProjectId, ServiceId, TaskId, TaskKind, TraceId, UserId, VolumeMode } from '@crewstation/contracts';
import type { Executor } from '@crewstation/persistence';
import { and, desc, eq, inArray, sql } from 'drizzle-orm';
import type { EnvironmentState, TaskEnvironment } from '../../domain/taskEnvironment';
import type { AdmissionRepository, EnvironmentRepository } from '../../ports/repositories';
import { admissions, environments } from './tables';

const json = <T>(v: unknown): T => (typeof v === 'string' ? JSON.parse(v) : v) as T;

export function drizzleEnvironmentRepository(db: Executor): EnvironmentRepository {
  const toEnv = (r: typeof environments.$inferSelect): TaskEnvironment => ({
    id: r.id as TaskId, projectId: r.projectId as ProjectId, serviceId: r.serviceId as ServiceId, kind: r.kind as TaskKind, state: r.state as EnvironmentState,
    volumeMode: r.volumeMode as VolumeMode, profile: r.profile, namespace: r.namespace, podName: r.podName, pvcName: r.pvcName, traceId: r.traceId as TraceId,
    runnerTokenHash: r.runnerTokenHash, connected: r.connected, ...(r.branch ? { branch: r.branch } : {}), ...(r.preview ? { preview: json<TaskEnvironment['preview']>(r.preview) } : {}),
    labels: json<Record<string, string>>(r.labels), ...(r.createdBy ? { createdBy: r.createdBy as UserId } : {}), ...(r.message ? { message: r.message } : {}),
    createdAt: r.createdAt, updatedAt: r.updatedAt, lastActivityAt: r.lastActivityAt,
  });
  const toRow = (e: TaskEnvironment): typeof environments.$inferInsert => ({ ...e, branch: e.branch ?? null, preview: e.preview ?? null, createdBy: e.createdBy ?? null, message: e.message ?? null });
  return {
    insert: async (e) => { await db.insert(environments).values(toRow(e)); },
    update: async (e) => { await db.update(environments).set(toRow(e)).where(eq(environments.id, e.id)); },
    getById: async (id) => { const row = (await db.select().from(environments).where(eq(environments.id, id)))[0]; return row ? toEnv(row) : undefined; },
    listByProject: async (projectId, states) => (await db.select().from(environments).where(states?.length ? and(eq(environments.projectId, projectId), inArray(environments.state, states)) : eq(environments.projectId, projectId)).orderBy(environments.createdAt)).map(toEnv),
    listByStates: async (states) => (await db.select().from(environments).where(inArray(environments.state, states))).map(toEnv),
    listByTrace: async (traceId) => (await db.select().from(environments).where(eq(environments.traceId, traceId)).orderBy(environments.createdAt)).map(toEnv),
    findDevSession: async (projectId, options) => {
      const scope = and(eq(environments.projectId, projectId), eq(environments.kind, 'dev-session'));
      const active = inArray(environments.state, ['creating', 'running', 'releasing']);
      // 只读展示最近一次失败；后续会话已释放时，不重新翻出更旧的失败冒充当前会话。
      const row = (await db.select().from(environments).where(and(scope, options?.includeLatestFailure ? undefined : active))
        .orderBy(sql`CASE WHEN ${active} THEN 0 ELSE 1 END`, desc(environments.createdAt), desc(environments.id)).limit(1))[0];
      return row && ['creating', 'running', 'releasing', 'failed'].includes(row.state) ? toEnv(row) : undefined;
    },
  };
}

export function drizzleAdmissionRepository(db: Executor): AdmissionRepository {
  return {
    tryAcquire: async (projectId, limit) => {
      await db.insert(admissions).values({ projectId, running: 0 }).onConflictDoNothing();
      const rows = await db.update(admissions).set({ running: sql`${admissions.running} + 1` }).where(and(eq(admissions.projectId, projectId), sql`${admissions.running} < ${limit}`)).returning({ running: admissions.running });
      return rows.length === 1;
    },
    release: async (projectId) => { await db.update(admissions).set({ running: sql`GREATEST(${admissions.running} - 1, 0)` }).where(eq(admissions.projectId, projectId)); },
    running: async (projectId) => (await db.select().from(admissions).where(eq(admissions.projectId, projectId)))[0]?.running ?? 0,
  };
}
