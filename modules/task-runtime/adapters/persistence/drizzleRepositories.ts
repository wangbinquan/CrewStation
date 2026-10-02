import type { ProjectId, ServiceId, TaskId, TaskKind, TraceId, UserId, VolumeMode } from '@crewstation/contracts';
import type { Executor } from '@crewstation/persistence';
import { and, desc, eq, gt, inArray, isNull, sql } from 'drizzle-orm';
import type { EnvironmentState, TaskEnvironment } from '../../domain/taskEnvironment';
import type { AdmissionRepository, EnvironmentRepository } from '../../ports/repositories';
import { environmentTraceQueries } from './environmentTraceQueries';
import { maintenanceEnvironmentReader } from './maintenanceEnvironments';
import { admissions, environments } from './tables';
import { readParentEndingJson, writeParentEndingJson } from './parentEndingJson';

const json = <T>(v: unknown): T => (typeof v === 'string' ? JSON.parse(v) : v) as T;

export function drizzleEnvironmentRepository(db: Executor): EnvironmentRepository {
  const toEnv = (r: typeof environments.$inferSelect): TaskEnvironment => ({
    ...(r.parentEndingPresent ? { parentEnding: readParentEndingJson(r.parentEnding, r.parentEndingKind) } : {}),
    ...(r.businessWorkspace ? { businessWorkspace: json<TaskEnvironment['businessWorkspace']>(r.businessWorkspace) } : {}),
    ...(r.runtimeInitialization ? { runtimeInitialization: json<TaskEnvironment['runtimeInitialization']>(r.runtimeInitialization) } : {}),
    ...(r.admissionFingerprint ? { admissionFingerprint: r.admissionFingerprint } : {}),
    ...(r.legacyCluster ? { legacyCluster: json<TaskEnvironment['legacyCluster']>(r.legacyCluster) } : {}),
    id: r.id as TaskId, projectId: r.projectId as ProjectId, serviceId: r.serviceId as ServiceId, kind: r.kind as TaskKind, state: r.state as EnvironmentState,
    volumeMode: r.volumeMode as VolumeMode, profile: r.profile, namespace: r.namespace, podName: r.podName, ...(r.podUid ? { podUid: r.podUid } : {}), pvcName: r.pvcName, traceId: r.traceId as TraceId,
    runnerTokenHash: r.runnerTokenHash, connected: r.connected, ...(r.branch ? { branch: r.branch } : {}), ...(r.preview ? { preview: json<TaskEnvironment['preview']>(r.preview) } : {}),
    labels: json<Record<string, string>>(r.labels), ...(r.createdBy ? { createdBy: r.createdBy as UserId } : {}), ...(r.message ? { message: r.message } : {}),
    createdAt: r.createdAt, updatedAt: r.updatedAt, lastActivityAt: r.lastActivityAt, ...(r.rebuildId ? { rebuildId: r.rebuildId } : {}),
    ...(r.native ? { native: json<TaskEnvironment['native']>(r.native) } : {}), ...(r.release ? { release: json<TaskEnvironment['release']>(r.release) } : {}), ...(r.runnerRejection ? { runnerRejection: json<TaskEnvironment['runnerRejection']>(r.runnerRejection) } : {}),
    ...(r.startup ? { startup: json<TaskEnvironment['startup']>(r.startup) } : {}), ...(r.render ? { render: json<TaskEnvironment['render']>(r.render) } : {}),
  });
  const toRow = (e: TaskEnvironment): typeof environments.$inferInsert => ({ ...e, parentEnding: writeParentEndingJson(e, 'parentEnding'), businessWorkspace: e.businessWorkspace ?? null, runtimeInitialization: e.runtimeInitialization ?? null, podUid: e.podUid ?? null, branch: e.branch ?? null, preview: e.preview ?? null, createdBy: e.createdBy ?? null, message: e.message ?? null, rebuildId: e.rebuildId ?? null, native: e.native ?? null, release: e.release ?? null, runnerRejection: e.runnerRejection ?? null, startup: e.startup ?? null, render: e.render ?? null });
  return {
    insert: async (e) => { await db.insert(environments).values(toRow(e)); },
    update: async (e) => { await db.update(environments).set(toRow(e)).where(eq(environments.id, e.id)); },
    getMaintenanceView: maintenanceEnvironmentReader(db, toEnv),
    getById: async (id) => { const row = (await db.select().from(environments).where(eq(environments.id, id)))[0]; return row ? toEnv(row) : undefined; },
    findByPhysicalPod: async (namespace, podName) => (await db.select().from(environments).where(and(eq(environments.namespace, namespace), eq(environments.podName, podName))).limit(2)).map(toEnv),
    getForUpdate: async (id) => { const row = (await db.select().from(environments).where(eq(environments.id, id)).for('update'))[0]; return row ? toEnv(row) : undefined; },
    listByProject: async (projectId, states, page) => (await db.select().from(environments).where(and(eq(environments.projectId, projectId), states?.length ? inArray(environments.state, states) : undefined, page?.after ? gt(environments.id, page.after) : undefined)).orderBy(page ? environments.id : environments.createdAt).limit(page ? Math.min(501, Math.max(1, page.limit)) : 2_147_483_647)).map(toEnv),
    listByStates: async (states, page) => (await db.select().from(environments).where(and(inArray(environments.state, states), page?.after ? gt(environments.id, page.after) : undefined)).orderBy(environments.id).limit(page ? Math.min(500, Math.max(1, page.limit)) : 2_147_483_647)).map(toEnv),
    ...environmentTraceQueries(db, toEnv),
    hasProtectedDevelopmentChildren: async (parentTaskId) => {
      const row = (await db.execute<{ present: boolean }>(sql`SELECT EXISTS(
        SELECT 1 FROM task_runtime.environments WHERE native->>'parentTaskId'=${parentTaskId}
          AND (render ? 'developmentUsageProtection' OR render ? 'developmentRemovalProtection' OR native ? 'developmentCleanup'
            OR render IS NOT NULL AND jsonb_typeof(render)<>'object')) AS present`))[0];
      if (typeof row?.present !== 'boolean') throw new Error('开发子执行存在性查询没有完整回执');
      return row.present;
    },
    listChildren: async (parentTaskId) => (await db.select().from(environments).where(sql`${environments.native}->>'parentTaskId' = ${parentTaskId}`).orderBy(environments.createdAt)).map(toEnv),
    // 部分索引 environments_starting 只覆盖启动中的行；按 id 翻页，观测用例轮流看完所有启动中的环境。
    listStarting: async (page) => (await db.select().from(environments).where(and(sql`${environments.startup}->>'state' = 'running'`, inArray(environments.state, ['creating', 'running']), page.after ? gt(environments.id, page.after) : undefined))
      .orderBy(environments.id).limit(Math.min(500, Math.max(1, page.limit)))).map(toEnv),
    pendingExecutions: async () => (await db.select().from(environments).where(sql`${environments.native}->>'state' IN ('queued', 'cleaning') OR (${environments.state} = 'releasing' AND ${environments.release} IS NOT NULL)`)).map(toEnv),
    findDevSession: async (projectId, options) => {
      const scope = and(eq(environments.projectId, projectId), eq(environments.kind, 'dev-session'), isNull(environments.native));
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
    block: async (taskId, serviceId) => { await db.execute(sql`INSERT INTO task_runtime.blocked_admissions(task_id,service_id) VALUES (${taskId},${serviceId}) ON CONFLICT DO NOTHING`); },
    blocked: async (taskId) => (await db.execute(sql`SELECT task_id FROM task_runtime.blocked_admissions WHERE task_id=${taskId}`)).length > 0,
    lock: async (projectId) => {
      await db.insert(admissions).values({ projectId, running: 0 }).onConflictDoNothing();
      await db.select().from(admissions).where(eq(admissions.projectId, projectId)).for('update');
    },
    tryAcquire: async (projectId, limit) => {
      await db.insert(admissions).values({ projectId, running: 0 }).onConflictDoNothing();
      const rows = await db.update(admissions).set({ running: sql`${admissions.running} + 1` }).where(and(eq(admissions.projectId, projectId), sql`${admissions.running} < ${limit}`)).returning({ running: admissions.running });
      return rows.length === 1;
    },
    release: async (projectId) => { await db.update(admissions).set({ running: sql`GREATEST(${admissions.running} - 1, 0)` }).where(eq(admissions.projectId, projectId)); },
    running: async (projectId) => (await db.select().from(admissions).where(eq(admissions.projectId, projectId)))[0]?.running ?? 0,
  };
}
