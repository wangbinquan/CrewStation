import type { ProjectId } from '@crewstation/contracts';
import type { Executor } from '@crewstation/persistence';
import { and, desc, eq, inArray, or, sql } from 'drizzle-orm';
import type { TaskEnvironment } from '../../domain/taskEnvironment';
import type { EnvironmentRepository } from '../../ports/repositories';
import { environments } from './tables';

type TraceQueries = Pick<EnvironmentRepository, 'traceKeys' | 'activeTraceIds' | 'listByProjectTraces'>;

/** 调用链只看项目里的开发会话与业务任务（含它们的 Agent 执行）；档位测试不属于任何项目的链。 */
const TRACE_KINDS = ['dev-session', 'business'];
const ACTIVE_STATES = ['creating', 'running', 'paused', 'releasing'];
/** 一次 IN 查询的 traceId 上限，远低于 PostgreSQL 的参数个数上限。 */
const CHUNK = 500;

/**
 * 按 traceId 分组的时间键（Design §14）。开始时间截到毫秒再比较与排序，游标里的时间与库里的一致；
 * 原生 SQL 读出的时间是字符串（dev-gotchas），这里直接取毫秒数。
 */
export function environmentTraceQueries(db: Executor, toEnv: (row: typeof environments.$inferSelect) => TaskEnvironment): TraceQueries {
  const scope = (projectId: ProjectId) => and(eq(environments.projectId, projectId), inArray(environments.kind, TRACE_KINDS));
  const firstKey = sql`date_trunc('milliseconds', min(${environments.createdAt}))`;
  const lastActivity = sql`greatest(${environments.updatedAt}, ${environments.lastActivityAt})`;
  return {
    traceKeys: async (projectId, page) => {
      const rows = await db.select({
        traceId: environments.traceId,
        firstMs: sql<string>`floor(extract(epoch from min(${environments.createdAt})) * 1000)::bigint`,
        lastMs: sql<string>`floor(extract(epoch from max(${lastActivity})) * 1000)::bigint`,
        active: sql<boolean>`bool_or(${inArray(environments.state, ACTIVE_STATES)})`,
      }).from(environments).where(scope(projectId)).groupBy(environments.traceId)
        .having(page.before ? sql`(${firstKey}, ${environments.traceId}) < (${page.before.at}::timestamptz, ${page.before.traceId})` : undefined)
        .orderBy(sql`${firstKey} desc`, desc(environments.traceId)).limit(Math.min(500, Math.max(1, page.limit)));
      return rows.map((r) => ({ traceId: r.traceId, firstAt: new Date(Number(r.firstMs)).toISOString(), lastAt: new Date(Number(r.lastMs)).toISOString(), active: r.active === true || String(r.active) === 't' }));
    },
    activeTraceIds: async (projectId, since) => (await db.selectDistinct({ traceId: environments.traceId }).from(environments)
      .where(and(scope(projectId), or(inArray(environments.state, ACTIVE_STATES), sql`${lastActivity} >= ${since}::timestamptz`)))).map((r) => r.traceId),
    listByProjectTraces: async (projectId, traceIds) => {
      const out: TaskEnvironment[] = [];
      for (let i = 0; i < traceIds.length; i += CHUNK) {
        const rows = await db.select().from(environments).where(and(scope(projectId), inArray(environments.traceId, [...traceIds.slice(i, i + CHUNK)]))).orderBy(environments.createdAt, environments.id);
        out.push(...rows.map(toEnv));
      }
      return out.sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime() || a.id.localeCompare(b.id));
    },
  };
}
