// RFC-034 v2 §3.3–§3.4 —— 只追加的价格线与项目费用可见性的 PostgreSQL 实现。

import type { ProjectId } from '@crewstation/contracts';
import type { Database } from '@crewstation/persistence';
import { and, asc, desc, eq, sql } from 'drizzle-orm';
import type { PriceVersion } from '../../domain/agentCallPricing';
import type { CostVisibilityStore, PriceStore } from '../../ports/observationPricing';
import { priceVersions, projectCostVisibility } from './tables';

function version(row: typeof priceVersions.$inferSelect): PriceVersion {
  return {
    id: row.id, profileId: row.profileId, model: row.model, inputMicro: row.inputMicro, cacheReadMicro: row.cacheReadMicro,
    cacheWriteMicro: row.cacheWriteMicro, outputMicro: row.outputMicro, effectiveFrom: row.effectiveFrom.getTime(),
    createdAt: row.createdAt.getTime(), createdBy: row.createdBy, note: row.note,
  };
}

export function drizzlePriceStore(db: Database): PriceStore {
  return {
    async line(profileId, model) {
      const rows = await db.select().from(priceVersions).where(and(eq(priceVersions.profileId, profileId), eq(priceVersions.model, model)))
        .orderBy(asc(priceVersions.createdAt), asc(priceVersions.id));
      return rows.map(version);
    },
    async all() {
      const rows = await db.select().from(priceVersions).orderBy(asc(priceVersions.profileId), asc(priceVersions.model), asc(priceVersions.createdAt), asc(priceVersions.id));
      return rows.map(version);
    },
    // 保存价格是少见的管理员操作：同一条线串行（事务级咨询锁），CAS 精确。
    append: (next, expectedLatestId) => db.transaction(async (tx) => {
      // 锁键里不能有 NUL：PostgreSQL 的文本参数拒绝 0x00，用 JSON 编码区分（档位, 模型）。
      await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtextextended(${'observability.price:' + JSON.stringify([next.profileId, next.model])}, 0))`);
      const [latest] = await tx.select({ id: priceVersions.id }).from(priceVersions).where(and(eq(priceVersions.profileId, next.profileId), eq(priceVersions.model, next.model)))
        .orderBy(desc(priceVersions.createdAt), desc(priceVersions.id)).limit(1);
      if ((latest?.id ?? null) !== expectedLatestId) return 'conflict' as const;
      await tx.insert(priceVersions).values({ ...next, effectiveFrom: new Date(next.effectiveFrom), createdAt: new Date(next.createdAt) });
      return 'appended' as const;
    }),
  };
}

export function drizzleCostVisibilityStore(db: Database): CostVisibilityStore {
  return {
    async read(projectId) {
      const [row] = await db.select().from(projectCostVisibility).where(eq(projectCostVisibility.projectId, projectId));
      return row ? { projectId: row.projectId as ProjectId, visible: row.visible, updatedAt: row.updatedAt, updatedBy: row.updatedBy } : undefined;
    },
    write: (record) => db.transaction(async (tx) => {
      await tx.execute(sql`SELECT observability.admit_project(${record.projectId})`);
      const [row] = await tx.insert(projectCostVisibility).values(record)
        .onConflictDoUpdate({ target: projectCostVisibility.projectId, set: { visible: record.visible, updatedAt: record.updatedAt, updatedBy: record.updatedBy } }).returning();
      return { projectId: row!.projectId as ProjectId, visible: row!.visible, updatedAt: row!.updatedAt, updatedBy: row!.updatedBy };
    }),
  };
}
