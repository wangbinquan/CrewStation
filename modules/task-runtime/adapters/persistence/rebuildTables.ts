import { text, timestamp } from 'drizzle-orm/pg-core';
import { jsonDocument } from '@crewstation/persistence';
import { taskRuntimeSchema } from './schema';

export const environmentRebuilds = taskRuntimeSchema.table('environment_rebuilds', {
  id: text('id').primaryKey(), taskId: text('task_id').notNull(), projectId: text('project_id').notNull(),
  input: jsonDocument('input').notNull(), namespace: text('namespace').notNull(),
  originalPodName: text('original_pod_name').notNull(), podName: text('pod_name').notNull(), pvcName: text('pvc_name').notNull(),
  secretName: text('secret_name').notNull(), image: text('image').notNull(), state: text('state').notNull(),
  podUid: text('pod_uid'), secretUid: text('secret_uid'), message: text('message'), failureReason: text('failure_reason'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull(), updatedAt: timestamp('updated_at', { withTimezone: true }).notNull(),
});
