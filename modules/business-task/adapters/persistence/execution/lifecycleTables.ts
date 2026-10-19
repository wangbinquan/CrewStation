import { boolean, integer, jsonb, text, timestamp } from 'drizzle-orm/pg-core';
import type { RuntimeImageExecutionSnapshot } from '@crewstation/contracts';
import type { RuntimeImageUpgradePayload } from '../../../domain/executionLifecycle';
import { businessTaskSchema } from '../schema';

export const executionTaskStates = businessTaskSchema.table('execution_task_states', {
  taskId: text('task_id').primaryKey(), serviceId: text('service_id').notNull(), generation: integer('generation').notNull(),
  state: text('state').notNull(), operationId: text('operation_id'),
  /** RFC-043: the current pin after an upgrade; NULL keeps the admission snapshot. */
  runtimeImage: jsonb('runtime_image').$type<RuntimeImageExecutionSnapshot>(),
});
export const executionLifecycles = businessTaskSchema.table('execution_lifecycles', {
  id: text('id').primaryKey(), serviceId: text('service_id').notNull(), taskId: text('task_id').notNull(), action: text('action').notNull(), requestKey: text('request_key').notNull(),
  expectedGeneration: integer('expected_generation').notNull(), generation: integer('generation').notNull(), priorState: text('prior_state').notNull(),
  epoch: integer('epoch'), state: text('state').notNull(), dispatched: boolean('dispatched').notNull().default(false),
  revision: integer('revision').notNull().default(0), owner: text('owner'), leaseUntil: timestamp('lease_until', { withTimezone: true }), errorCode: text('error_code'),
  payload: jsonb('payload').$type<RuntimeImageUpgradePayload>(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull(),
});
