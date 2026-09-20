import type { ProjectId, TaskId } from '@crewstation/contracts';
import { RebuildDevSessionRequestSchema } from '@crewstation/contracts';
import type { Executor } from '@crewstation/persistence';
import { and, eq, inArray, sql } from 'drizzle-orm';
import type { EnvironmentRebuild } from '../../domain/environmentRebuild';
import type { RebuildRepository } from '../../ports/rebuilds';
import { environmentRebuilds } from './rebuildTables';

export function drizzleRebuildRepository(db: Executor): RebuildRepository {
  const row = (record: EnvironmentRebuild): typeof environmentRebuilds.$inferInsert => ({ ...record, nodeName: record.nodeName ?? null, podUid: record.podUid ?? null, secretUid: record.secretUid ?? null, message: record.message ?? null, failureReason: record.failureReason ?? null });
  const fromRow = (item: typeof environmentRebuilds.$inferSelect): EnvironmentRebuild => {
    const { podUid, secretUid, message, failureReason, nodeName, legacyCluster, ...rest } = item;
    return { ...rest, taskId: item.taskId as TaskId, projectId: item.projectId as ProjectId, state: item.state as EnvironmentRebuild['state'],
      input: RebuildDevSessionRequestSchema.parse(typeof item.input === 'string' ? JSON.parse(item.input) : item.input),
      ...(legacyCluster ? { legacyCluster } : {}),
      ...(podUid ? { podUid } : {}), ...(secretUid ? { secretUid } : {}), ...(message ? { message } : {}), ...(failureReason ? { failureReason } : {}), ...(nodeName ? { nodeName } : {}) };
  };
  return {
    findRequest: async (projectId, requestId) => {
      const item = (await db.select().from(environmentRebuilds).where(and(eq(environmentRebuilds.projectId, projectId), sql`${environmentRebuilds.input}->>'requestId' = ${requestId}`)))[0];
      return item ? fromRow(item) : undefined;
    },
    get: async (id) => {
      const item = (await db.select().from(environmentRebuilds).where(eq(environmentRebuilds.id, id)))[0];
      if (!item) return undefined;
      return fromRow(item);
    },
    pending: async () => (await db.select().from(environmentRebuilds).where(inArray(environmentRebuilds.state, ['queued', 'replacing']))).map(fromRow),
    insert: async (record) => { await db.insert(environmentRebuilds).values(row(record)); },
    update: async (record) => { await db.update(environmentRebuilds).set(row(record)).where(eq(environmentRebuilds.id, record.id)); },
  };
}
