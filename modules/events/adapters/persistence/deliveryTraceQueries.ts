import type { ProjectId } from '@crewstation/contracts';
import type { Executor } from '@crewstation/persistence';
import { and, desc, eq, inArray, or, sql } from 'drizzle-orm';
import type { Delivery } from '../../domain/delivery';
import type { DeliveryRepository } from '../../ports/repositories';
import { deliveries } from './tables';

type TraceQueries = Pick<DeliveryRepository, 'traceKeys' | 'activeTraceIds' | 'listByProjectTraces'>;

/** 还没有结果的投递：待投、投递中、等重试、维护暂存。送达与死信是结果。 */
const ACTIVE_STATES = ['pending', 'delivering', 'retrying', 'held'];
const CHUNK = 500;

/**
 * 投递按 traceId 分组的时间键（Design §14）。一个事件投给多个订阅项目时共用 traceId，这里只看本项目的那几条。
 * 开始时间截到毫秒再比较与排序；原生 SQL 读出的时间是字符串（dev-gotchas），这里直接取毫秒数。
 */
export function deliveryTraceQueries(db: Executor, toDelivery: (row: typeof deliveries.$inferSelect) => Delivery): TraceQueries {
  const firstKey = sql`date_trunc('milliseconds', min(${deliveries.createdAt}))`;
  return {
    traceKeys: async (projectId, page) => {
      const rows = await db.select({
        traceId: deliveries.traceId,
        firstMs: sql<string>`floor(extract(epoch from min(${deliveries.createdAt})) * 1000)::bigint`,
        lastMs: sql<string>`floor(extract(epoch from max(${deliveries.updatedAt})) * 1000)::bigint`,
        active: sql<boolean>`bool_or(${inArray(deliveries.state, ACTIVE_STATES)})`,
      }).from(deliveries).where(eq(deliveries.projectId, projectId)).groupBy(deliveries.traceId)
        .having(page.before ? sql`(${firstKey}, ${deliveries.traceId}) < (${page.before.at}::timestamptz, ${page.before.traceId})` : undefined)
        .orderBy(sql`${firstKey} desc`, desc(deliveries.traceId)).limit(Math.min(500, Math.max(1, page.limit)));
      return rows.map((r) => ({ traceId: r.traceId, firstAt: new Date(Number(r.firstMs)).toISOString(), lastAt: new Date(Number(r.lastMs)).toISOString(), active: r.active === true || String(r.active) === 't' }));
    },
    activeTraceIds: async (projectId: ProjectId, since: string) => (await db.selectDistinct({ traceId: deliveries.traceId }).from(deliveries)
      .where(and(eq(deliveries.projectId, projectId), or(inArray(deliveries.state, ACTIVE_STATES), sql`${deliveries.updatedAt} >= ${since}::timestamptz`)))).map((r) => r.traceId),
    listByProjectTraces: async (projectId, traceIds) => {
      const out: Delivery[] = [];
      for (let i = 0; i < traceIds.length; i += CHUNK) {
        const rows = await db.select().from(deliveries).where(and(eq(deliveries.projectId, projectId), inArray(deliveries.traceId, [...traceIds.slice(i, i + CHUNK)]))).orderBy(deliveries.createdAt, deliveries.id);
        out.push(...rows.map(toDelivery));
      }
      return out.sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime() || a.id.localeCompare(b.id));
    },
  };
}
