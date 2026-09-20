import { boolean, integer, text, timestamp } from 'drizzle-orm/pg-core';
import { jsonDocument } from '@crewstation/persistence';
import type { TaskEnvironment } from '../../domain/taskEnvironment';
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
  podUid: text('pod_uid'),
  pvcName: text('pvc_name').notNull(),
  traceId: text('trace_id').notNull(),
  runnerTokenHash: text('runner_token_hash').notNull(),
  connected: boolean('connected').notNull().default(false),
  branch: text('branch'),
  preview: jsonDocument('preview'),
  labels: jsonDocument('labels').notNull(),
  createdBy: text('created_by'),
  message: text('message'),
  rebuildId: text('rebuild_id'),
  native: jsonDocument('native').$type<TaskEnvironment['native']>(),
  release: jsonDocument('release').$type<TaskEnvironment['release']>(),
  runnerRejection: jsonDocument('runner_rejection').$type<TaskEnvironment['runnerRejection']>(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull(),
  lastActivityAt: timestamp('last_activity_at', { withTimezone: true }).notNull(),
});

export const admissions = taskRuntimeSchema.table('admissions', {
  projectId: text('project_id').primaryKey(),
  running: integer('running').notNull().default(0),
});
