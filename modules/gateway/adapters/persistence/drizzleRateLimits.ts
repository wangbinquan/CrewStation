import type { UserId } from '@crewstation/contracts';
import type { Executor } from '@crewstation/persistence';
import { and, eq } from 'drizzle-orm';
import type { RateLimitRepository, RateLimitRow } from '../../ports/repositories';
import { rateLimits } from './tables';

const toRow = (row: typeof rateLimits.$inferSelect): RateLimitRow => ({ scope: row.scope, body: row.body, revision: row.revision, updatedAt: row.updatedAt, updatedBy: row.updatedBy as UserId });

/** 限流策略（RFC-025 T10）：新建靠主键冲突挡住并发的第二个，改与删都带版本号条件。 */
export function drizzleRateLimitRepository(db: Executor): RateLimitRepository {
  return {
    get: async (scope) => { const row = (await db.select().from(rateLimits).where(eq(rateLimits.scope, scope)).limit(1))[0]; return row ? toRow(row) : undefined; },
    list: async () => (await db.select().from(rateLimits)).map(toRow),
    save: async (scope, body, expectedRevision, at, by) => {
      const values = { body, revision: expectedRevision + 1, updatedAt: at, updatedBy: by };
      const rows = expectedRevision === 0
        ? await db.insert(rateLimits).values({ scope, ...values }).onConflictDoNothing().returning()
        : await db.update(rateLimits).set(values).where(and(eq(rateLimits.scope, scope), eq(rateLimits.revision, expectedRevision))).returning();
      return rows[0] ? toRow(rows[0]) : undefined;
    },
    remove: async (scope, expectedRevision) => (await db.delete(rateLimits).where(and(eq(rateLimits.scope, scope), eq(rateLimits.revision, expectedRevision))).returning({ scope: rateLimits.scope })).length > 0,
  };
}
