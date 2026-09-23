import { text, timestamp } from 'drizzle-orm/pg-core';
import { observabilitySchema } from './schema';

export const alerts = observabilitySchema.table('alerts', {
  id: text('id').primaryKey(),
  projectId: text('project_id').notNull(),
  type: text('type').notNull(),
  key: text('key').notNull(),
  state: text('state').notNull(),
  detail: text('detail').notNull(),
  firedAt: timestamp('fired_at', { withTimezone: true }).notNull(),
  resolvedAt: timestamp('resolved_at', { withTimezone: true }),
});
