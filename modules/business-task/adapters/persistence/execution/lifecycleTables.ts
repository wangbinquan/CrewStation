import { boolean, integer, text, timestamp } from 'drizzle-orm/pg-core';
import { businessTaskSchema } from '../schema';

export const executionTaskStates = businessTaskSchema.table('execution_task_states', {
  taskId: text('task_id').primaryKey(), serviceId: text('service_id').notNull(), generation: integer('generation').notNull(),
  state: text('state').notNull(), operationId: text('operation_id'),
});
export const executionLifecycles = businessTaskSchema.table('execution_lifecycles', {
  id: text('id').primaryKey(), serviceId: text('service_id').notNull(), taskId: text('task_id').notNull(), action: text('action').notNull(), requestKey: text('request_key').notNull(),
  expectedGeneration: integer('expected_generation').notNull(), generation: integer('generation').notNull(), priorState: text('prior_state').notNull(),
  epoch: integer('epoch'), state: text('state').notNull(), dispatched: boolean('dispatched').notNull().default(false),
  revision: integer('revision').notNull().default(0), owner: text('owner'), leaseUntil: timestamp('lease_until', { withTimezone: true }), errorCode: text('error_code'),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull(),
});
