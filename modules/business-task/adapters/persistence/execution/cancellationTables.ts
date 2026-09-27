import { integer, text, timestamp, uniqueIndex } from 'drizzle-orm/pg-core';
import { businessTaskSchema } from '../schema';

export const executionCancellations = businessTaskSchema.table('execution_cancellations', {
  id: text('id').primaryKey(), serviceId: text('service_id').notNull(), taskId: text('task_id').notNull(), subtaskId: text('subtask_id').notNull(),
  requestKey: text('request_key').notNull(), requestDigest: text('request_digest').notNull(), expectedAttempt: integer('expected_attempt').notNull(), epoch: integer('epoch'),
  state: text('state').notNull(), errorCode: text('error_code'), owner: text('owner'), revision: integer('revision').notNull().default(0),
  leaseUntil: timestamp('lease_until', { withTimezone: true }), updatedAt: timestamp('updated_at', { withTimezone: true }).notNull(),
}, (t) => [uniqueIndex('execution_cancellations_request').on(t.serviceId, t.subtaskId, t.requestKey)]);
