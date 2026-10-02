import { boolean, integer, text, timestamp } from 'drizzle-orm/pg-core';
import { jsonDocument } from '@crewstation/persistence';
import type { EnvironmentRebuild } from '../../domain/environmentRebuild';
import { taskRuntimeSchema } from './schema';
import { sql } from 'drizzle-orm';
import { parentEndingDocument } from './parentEndingJson';

export const environmentRebuilds = taskRuntimeSchema.table('environment_rebuilds', {
  developmentParentBinding: parentEndingDocument('development_parent_binding'),
  developmentParentBindingPresent: boolean('development_parent_binding_present').generatedAlwaysAs(sql`development_parent_binding IS NOT NULL`),
  developmentParentBindingKind: text('development_parent_binding_kind').generatedAlwaysAs(sql`jsonb_typeof(development_parent_binding)`),
  legacyCluster: jsonDocument('legacy_cluster').$type<EnvironmentRebuild['legacyCluster']>(),
  id: text('id').primaryKey(), taskId: text('task_id').notNull(), projectId: text('project_id').notNull(),
  input: jsonDocument('input').notNull(), namespace: text('namespace').notNull(),
  originalPodName: text('original_pod_name').notNull(), podName: text('pod_name').notNull(), pvcName: text('pvc_name').notNull(),
  secretName: text('secret_name').notNull(), image: text('image').notNull(), state: text('state').notNull(),
  creation: text('creation').$type<'owner' | 'ledger'>().notNull().default('owner'), attempts: integer('attempts').notNull().default(0),
  nodeName: text('node_name'),
  podUid: text('pod_uid'), secretUid: text('secret_uid'), message: text('message'), failureReason: text('failure_reason'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull(), updatedAt: timestamp('updated_at', { withTimezone: true }).notNull(),
});
