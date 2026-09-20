import { text, timestamp } from 'drizzle-orm/pg-core';
import { devSessionSchema } from './schema';

export const comparisonReferences = devSessionSchema.table('comparison_references', {
  id: text('id').primaryKey(), taskId: text('task_id').notNull(), runnerComparisonId: text('runner_comparison_id').notNull(),
  target: text('target').notNull(), deployment: text('deployment').notNull(), createdAt: timestamp('created_at', { withTimezone: true }).notNull(),
});
