import type { WorkspaceLayout } from '@crewstation/contracts';
import type { Database } from '@crewstation/persistence';
import { jsonDocument } from '@crewstation/persistence';
import { and, eq, sql } from 'drizzle-orm';
import { integer, primaryKey, text, timestamp } from 'drizzle-orm/pg-core';
import type { WorkspaceLayouts } from '../../ports/workspaceLayouts';
import { devSessionSchema } from './schema';

const table = devSessionSchema.table('workspace_layouts', {
  taskId: text('task_id').notNull(), userId: text('user_id').notNull(), revision: integer('revision').notNull(),
  layout: jsonDocument('layout').$type<WorkspaceLayout>().notNull(), updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => [primaryKey({ columns: [t.taskId, t.userId] })]);
const dto = (row: typeof table.$inferSelect | undefined) => row ? { revision: row.revision, layout: row.layout, updatedAt: row.updatedAt.toISOString() } : undefined;

export function drizzleWorkspaceLayouts(db: Database): WorkspaceLayouts {
  return {
    async get(taskId, userId) {
      return dto((await db.select().from(table).where(and(eq(table.taskId, taskId), eq(table.userId, userId))))[0]);
    },
    async save(taskId, userId, expectedRevision, layout) {
      if (expectedRevision === 0) return dto((await db.insert(table).values({ taskId, userId, layout, revision: 1 }).onConflictDoNothing().returning())[0]);
      return dto((await db.update(table).set({ layout, revision: expectedRevision + 1, updatedAt: sql`now()` })
        .where(and(eq(table.taskId, taskId), eq(table.userId, userId), eq(table.revision, expectedRevision))).returning())[0]);
    },
  };
}
