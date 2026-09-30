import { integer, text, timestamp } from 'drizzle-orm/pg-core';
import type { ProjectDeletionOperation, ProjectDeletionPlan } from '@crewstation/contracts';
import { jsonDocument } from '@crewstation/persistence';
import { projectSchema } from '../schema';

export const deletionPlans = projectSchema.table('deletion_plans', {
  id: text('id').primaryKey(), projectId: text('project_id').notNull(), body: jsonDocument('body').$type<ProjectDeletionPlan>().notNull(),
  requestedBy: text('requested_by').notNull(), createdAt: timestamp('created_at', { withTimezone: true }).notNull(), expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
});
export const deletionOperations = projectSchema.table('deletion_operations', {
  id: text('id').primaryKey(), projectId: text('project_id').notNull().unique(), planId: text('plan_id').notNull(),
  requestKey: text('request_key').notNull().unique(), requestedBy: text('requested_by').notNull(),
  body: jsonDocument('body').$type<ProjectDeletionOperation>().notNull(), generation: integer('generation').notNull(),
  leaseOwner: text('lease_owner'), leaseUntil: timestamp('lease_until', { withTimezone: true }),
});
