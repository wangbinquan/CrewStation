import { boolean, integer, jsonb, text, timestamp } from 'drizzle-orm/pg-core';
import { taskRuntimeSchema } from './schema';

export const environments = taskRuntimeSchema.table('environments', {
  id: text('id').primaryKey(),
  projectId: text('project_id').notNull(),
  serviceId: text('service_id').notNull(),
  kind: text('kind').notNull(),
  state: text('state').notNull(),
  volumeMode: text('volume_mode').notNull(),
  profile: text('profile').notNull(),
  namespace: text('namespace').notNull(),
  podName: text('pod_name').notNull(),
  pvcName: text('pvc_name').notNull(),
  traceId: text('trace_id').notNull(),
  runnerTokenHash: text('runner_token_hash').notNull(),
  connected: boolean('connected').notNull().default(false),
  branch: text('branch'),
  preview: jsonb('preview'),
  labels: jsonb('labels').notNull(),
  createdBy: text('created_by'),
  message: text('message'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull(),
  lastActivityAt: timestamp('last_activity_at', { withTimezone: true }).notNull(),
});

export const admissions = taskRuntimeSchema.table('admissions', {
  projectId: text('project_id').primaryKey(),
  running: integer('running').notNull().default(0),
});
