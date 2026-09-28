import { and, desc, inArray, lt, sql } from 'drizzle-orm';
import { ObjectArchiveHistoryPageSchema, ObjectPageQuerySchema } from '@crewstation/contracts';
import type { Database } from '@crewstation/persistence';
import type { ObjectReadRepository } from '../../../ports/objectStorage';
import { finalizationBindings as bindings } from '../objectTables';

/** Includes completed receipts after blockers clear; newest operations first within authorized spaces. */
export function archiveHistory(db: Database): ObjectReadRepository['archiveHistory'] {
  return async (spaceIds, limit, cursor) => {
    ObjectPageQuerySchema.parse({ limit, cursor });
    if (!spaceIds.length) return { items: [], nextCursor: null };
    const rows = await db.select({ operationId: bindings.id, taskId: bindings.taskId, revision: sql<number>`(${bindings.body}->>'revision')::int`, state: bindings.state,
      receiptId: sql<string | null>`${bindings.body}->'receipt'->>'id'`, createdAt: sql<string>`${bindings.body}->>'createdAt'`, updatedAt: sql<string>`${bindings.body}->>'updatedAt'`,
    }).from(bindings).where(and(inArray(bindings.spaceId, [...spaceIds]), cursor ? lt(bindings.id, cursor) : undefined)).orderBy(desc(bindings.id)).limit(limit + 1);
    return ObjectArchiveHistoryPageSchema.parse({ items: rows.slice(0, limit), nextCursor: rows.length > limit ? rows[limit - 1]!.operationId : null });
  };
}
