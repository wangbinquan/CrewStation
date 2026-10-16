import { integer, text, timestamp, uniqueIndex } from 'drizzle-orm/pg-core';
import { businessTaskSchema } from '../schema';

export const executionMaterials = businessTaskSchema.table('execution_materials', {
  state: text('state').$type<'preparing' | 'ready' | 'releasing' | 'released'>().notNull().default('ready'),
  id: text('id').primaryKey(), serviceId: text('service_id').notNull(), taskId: text('task_id').notNull(), requestKey: text('request_key').notNull(),
  digest: text('digest').notNull(), sealed: text('sealed').notNull(), sizeBytes: integer('size_bytes').notNull(), createdAt: timestamp('created_at', { withTimezone: true }).notNull(),
  /** RFC-040: object pins of this revision belong to the material; a revived material pins a new revision. */
  pinRevision: integer('pin_revision').notNull().default(1), objectCount: integer('object_count'), pinnedAt: timestamp('pinned_at', { withTimezone: true }),
}, (t) => [uniqueIndex('execution_materials_request').on(t.serviceId, t.taskId, t.requestKey)]);
