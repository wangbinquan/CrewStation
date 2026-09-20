import { integer, text, timestamp, uniqueIndex } from 'drizzle-orm/pg-core';
import { dataSchema } from './schema';

export const resources = dataSchema.table('resources', {
  id: text('id').primaryKey(),
  projectId: text('project_id').notNull(),
  serviceId: text('service_id').notNull(),
  kind: text('kind').notNull(),
  env: text('env').notNull(),
  plan: text('plan').notNull(),
  state: text('state').notNull(),
  envVar: text('env_var').notNull(),
  objectName: text('object_name').notNull(),
  secretBox: text('secret_box'),
  message: text('message'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull(),
}, (t) => [uniqueIndex('resources_service_env_kind_idx').on(t.serviceId, t.env, t.kind)]);

export const taskBindings = dataSchema.table('task_bindings', {
  legacyResourceId: text('legacy_resource_id'),
  id: text('id').primaryKey(),
  taskId: text('task_id').notNull(),
  serviceId: text('service_id').notNull(),
  projectId: text('project_id').notNull(),
  mode: text('mode').notNull(),
  state: text('state').notNull(),
  reason: text('reason'),
  decision: text('decision'),
  requestedBy: text('requested_by').notNull(),
  decidedBy: text('decided_by'),
  ttlMinutes: integer('ttl_minutes').notNull(),
  expiresAt: timestamp('expires_at', { withTimezone: true }),
  roleName: text('role_name'),
  secretBox: text('secret_box'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull(),
});
