import { integer, text, timestamp, uniqueIndex } from 'drizzle-orm/pg-core';
import { businessTaskSchema } from '../schema';

export const executionMaterials = businessTaskSchema.table('execution_materials', {
  id: text('id').primaryKey(), serviceId: text('service_id').notNull(), taskId: text('task_id').notNull(), requestKey: text('request_key').notNull(),
  digest: text('digest').notNull(), sealed: text('sealed').notNull(), sizeBytes: integer('size_bytes').notNull(), createdAt: timestamp('created_at', { withTimezone: true }).notNull(),
}, (t) => [uniqueIndex('execution_materials_request').on(t.serviceId, t.taskId, t.requestKey)]);
