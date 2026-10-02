import { z } from 'zod';
import { ResourceIdSchema } from '@crewstation/contracts';
import type { Executor } from '@crewstation/persistence';
import { and, asc, eq, gt, inArray, lte, sql } from 'drizzle-orm';
import { precondition } from '@crewstation/kernel';
import { enqueueJob } from '@crewstation/queue';
import { DEVELOPMENT_PARENT_ENDING_JOB_KIND } from '../../ports/developmentParentEnding';
import { REBUILD_JOB_KIND } from '../../ports/rebuilds';
import { drizzleDevelopmentParentEndings, drizzleDevelopmentParentRebuildClaims } from './developmentParentEndings';
import { developmentParentRecoverySweep as sweep } from './developmentParentEndingTables';
import { environmentRebuilds as rebuilds } from './rebuildTables';
import { environments } from './tables';

const families = ['ending', 'claim', 'rebuild'] as const;
const OldCursorSchema = z.strictObject({ version: z.literal(1), ending: ResourceIdSchema.nullable(), claim: ResourceIdSchema.nullable() });
const CursorSchema = z.strictObject({ version: z.literal(2), ending: ResourceIdSchema.nullable(), claim: ResourceIdSchema.nullable(), rebuild: ResourceIdSchema.nullable(), next: z.enum(families) });
/** Read old scalar/v1 cursors without resetting their positions. The v2 next field owns rotation; the SQL kind remains a legal old mirror. */
function cursors(row: typeof sweep.$inferSelect) {
  if (!row.afterId) return CursorSchema.parse({ version: 2, ending: null, claim: null, rebuild: null, next: row.kind });
  if (!row.afterId.startsWith('{')) return CursorSchema.parse({ version: 2, ending: row.kind === 'ending' ? row.afterId : null, claim: row.kind === 'claim' ? row.afterId : null, rebuild: null, next: row.kind });
  const parsed: unknown = JSON.parse(row.afterId);
  if (typeof parsed === 'object' && parsed !== null && 'version' in parsed && parsed.version === 2) return CursorSchema.parse(parsed);
  const old = OldCursorSchema.parse(parsed);
  return CursorSchema.parse({ ...old, version: 2, rebuild: null, next: row.kind });
}
async function publishedRebuilds(db: Executor, afterId: string | null, cutoff: Date, limit: number) {
  return (await db.select({ id: rebuilds.id }).from(rebuilds).innerJoin(environments,
    and(eq(environments.id, rebuilds.taskId), eq(environments.projectId, rebuilds.projectId), eq(environments.rebuildId, rebuilds.id)))
    .where(and(eq(rebuilds.developmentParentBindingPresent, true), inArray(rebuilds.state, ['queued', 'replacing']), lte(rebuilds.updatedAt, cutoff),
      eq(environments.kind, 'dev-session'), eq(environments.state, 'creating'), sql`${environments.native} IS NULL`, eq(environments.parentEndingPresent, false),
      afterId ? gt(rebuilds.id, afterId) : undefined)).orderBy(asc(rebuilds.id)).limit(limit)).map(({ id }) => ({ id, requestId: id }));
}
export function developmentParentRecovery(db: Executor, transactional: boolean) {
  return { refill: async (cutoff: Date, limit = 25): Promise<number> => {
    if (!transactional || !Number.isSafeInteger(limit) || limit < 1 || limit > 25) throw precondition('原父恢复需要实际事务与总预算 25');
    await db.insert(sweep).values({ singleton: true, kind: 'ending', scanCutoff: cutoff }).onConflictDoNothing();
    const row = (await db.select().from(sweep).where(eq(sweep.singleton, true)).for('update'))[0]!;
    const cursor = cursors(row), offset = families.indexOf(cursor.next), order = [...families.slice(offset), ...families.slice(0, offset)];
    let count = 0;
    for (const [index, kind] of order.entries()) {
      const budget = Math.ceil((limit - count) / (order.length - index));
      if (!budget) break;
      const entries = kind === 'ending' ? (await drizzleDevelopmentParentEndings(db).due(cursor.ending, cutoff, budget)).map((id) => ({ id, requestId: id }))
        : kind === 'claim' ? (await drizzleDevelopmentParentRebuildClaims(db).due(cursor.claim, cutoff, budget)).map((claim) => ({ id: claim.sourceEndingId, requestId: claim.currentRebuildId }))
          : await publishedRebuilds(db, cursor.rebuild, cutoff, budget);
      for (const entry of entries) await enqueueJob(db, kind === 'ending' ? DEVELOPMENT_PARENT_ENDING_JOB_KIND : REBUILD_JOB_KIND,
        kind === 'ending' ? { endingId: entry.id } : { requestId: entry.requestId }, { dedupKey: entry.requestId, maxAttempts: 5 });
      cursor[kind] = entries.length === budget ? ResourceIdSchema.parse(entries.at(-1)!.id) : null;
      count += entries.length;
    }
    cursor.next = families[(offset + 1) % families.length]!;
    await db.update(sweep).set({ kind: cursor.next === 'rebuild' ? row.kind : cursor.next, scanCutoff: cutoff, afterId: JSON.stringify(cursor), epoch: sql`${sweep.epoch} + 1` }).where(eq(sweep.singleton, true));
    return count;
  } };
}
