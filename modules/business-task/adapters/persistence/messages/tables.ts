import { boolean, integer, text, timestamp, uniqueIndex } from 'drizzle-orm/pg-core';
import type { TaskId } from '@crewstation/contracts';
import { businessTaskSchema } from '../schema';
export const executionMessages = businessTaskSchema.table('execution_messages', {
  id: text('id').primaryKey(), serviceId: text('service_id').notNull(), taskId: text('task_id').$type<TaskId>().notNull(), subtaskId: text('subtask_id').notNull(),
  requestKey: text('request_key').notNull(), requestDigest: text('request_digest').notNull(), attempt: integer('attempt').notNull(),
  executionId: text('execution_id').notNull(), runtimeTaskId: text('runtime_task_id').$type<TaskId>().notNull(), incarnation: text('incarnation').notNull(),
  payloadDigest: text('payload_digest').notNull(), sealedPayload: text('sealed_payload').notNull(), epoch: integer('epoch'),
  dispatched: boolean('dispatched').notNull().default(false), state: text('state').notNull(), errorCode: text('error_code'),
  owner: text('owner'), revision: integer('revision').notNull().default(0), leaseUntil: timestamp('lease_until', { withTimezone: true }),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull(),
}, (t) => [uniqueIndex('execution_messages_request').on(t.serviceId, t.subtaskId, t.requestKey)]);
