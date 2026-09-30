import type { UserId } from '@crewstation/contracts';
import { conflict } from '@crewstation/kernel';
import { coordinateRateLimits } from './rateLimitCoordination';
import { rateLimitReceipts } from './rateLimitReceiptTable';
import type { Executor } from '@crewstation/persistence';
import { and, eq } from 'drizzle-orm';
import type { RateLimitRepository, RateLimitRow } from '../../ports/repositories';
import { rateLimits } from './tables';

const toRow = (row: typeof rateLimits.$inferSelect): RateLimitRow => ({ scope: row.scope, body: row.body, revision: row.revision, updatedAt: row.updatedAt, updatedBy: row.updatedBy as UserId });

/** 限流策略（RFC-025 T10）：新建靠主键冲突挡住并发的第二个，改与删都带版本号条件。 */
export function drizzleRateLimitRepository(db: Executor): RateLimitRepository {
  return {
    resourceChangeReceipt: async (projectId, operationId) => { const body = (await db.select().from(rateLimitReceipts).where(and(eq(rateLimitReceipts.projectId, projectId), eq(rateLimitReceipts.operationId, operationId))))[0]?.body; return body ? { revision: body.revision, effect: body.effect, applied: body.applied } : undefined; },
    applyResourceChange: (input) => coordinateRateLimits(db, async (tx) => {
      const old = (await tx.select().from(rateLimitReceipts).where(eq(rateLimitReceipts.operationId, input.operationId)))[0];
      if (old) { if (old.projectId !== input.projectId || old.body.hash !== input.hash) throw conflict('同一限流操作不能改变内容'); return { revision: old.body.revision, effect: old.body.effect, applied: old.body.applied }; }
      const repository = drizzleRateLimitRepository(tx), platform = await repository.get('platform'), project = await repository.get(input.projectId);
      if ((platform?.revision ?? 0) !== input.expectedPlatformRevision || (project?.revision ?? 0) !== input.expectedRevision) throw conflict('平台默认或项目限流已变化');
      let revision = 0;
      if (input.override === null) { if (project && !await repository.remove(input.projectId, project.revision)) throw conflict('限流覆盖已变化'); }
      else { const saved = await repository.save(input.projectId, input.override, input.expectedRevision, input.now, input.actorId); if (!saved) throw conflict('限流覆盖已变化'); revision = saved.revision; }
      const receipt = { revision: String(revision), effect: '限流政策已保存，等待网关中间件实际同步', applied: false };
      await tx.insert(rateLimitReceipts).values({ operationId: input.operationId, projectId: input.projectId, body: { hash: input.hash, ...receipt } });
      return receipt;
    }),
    get: async (scope) => { const row = (await db.select().from(rateLimits).where(eq(rateLimits.scope, scope)).limit(1))[0]; return row ? toRow(row) : undefined; },
    list: async () => (await db.select().from(rateLimits)).map(toRow),
    save: (scope, body, expectedRevision, at, by) => coordinateRateLimits(db, async (tx) => {
      const values = { body, revision: expectedRevision + 1, updatedAt: at, updatedBy: by };
      const rows = expectedRevision === 0
        ? await tx.insert(rateLimits).values({ scope, ...values }).onConflictDoNothing().returning()
        : await tx.update(rateLimits).set(values).where(and(eq(rateLimits.scope, scope), eq(rateLimits.revision, expectedRevision))).returning();
      return rows[0] ? toRow(rows[0]) : undefined;
    }),
    remove: (scope, expectedRevision) => coordinateRateLimits(db, async (tx) => (await tx.delete(rateLimits).where(and(eq(rateLimits.scope, scope), eq(rateLimits.revision, expectedRevision))).returning({ scope: rateLimits.scope })).length > 0),
  };
}
