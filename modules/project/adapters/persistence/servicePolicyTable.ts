import { integer, jsonb, text, timestamp } from 'drizzle-orm/pg-core';
import { projectSchema } from './schema';

export const servicePlanPolicies = projectSchema.table('service_plan_policies', {
  projectId: text('project_id').primaryKey(),
  policy: jsonb('policy').notNull(),
  revision: integer('revision').notNull(),
  updatedBy: text('updated_by').notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull(),
});
