import { integer, text, timestamp, uniqueIndex } from 'drizzle-orm/pg-core';
import { jsonDocument } from '@crewstation/persistence';
import type { TaskAdmissionIntent } from '../../domain/taskAdmission';
import type { ExecutionControl } from '../../domain/executionControl';
import { businessTaskSchema } from './schema';

export const executionControls = businessTaskSchema.table('execution_controls', {
  serviceId: text('service_id').primaryKey(), body: jsonDocument('body').$type<ExecutionControl>().notNull(),
});

export const executionOperations = businessTaskSchema.table('execution_operations', {
  id: text('id').primaryKey(), serviceId: text('service_id').notNull(), kind: text('kind').notNull(),
  parentId: text('parent_id').notNull(), requestKey: text('request_key').notNull(),
  requestDigest: text('request_digest').notNull(), effectiveDigest: text('effective_digest').notNull(),
  intent: jsonDocument('intent').$type<TaskAdmissionIntent>().notNull(), epoch: integer('epoch'),
  state: text('state').notNull(), revision: integer('revision').notNull().default(0), attempts: integer('attempts').notNull().default(0),
  leaseOwner: text('lease_owner'), leaseUntil: timestamp('lease_until', { withTimezone: true }), errorCode: text('error_code'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull(), updatedAt: timestamp('updated_at', { withTimezone: true }).notNull(),
}, (t) => [uniqueIndex('execution_operations_request').on(t.serviceId, t.kind, t.parentId, t.requestKey)]);
