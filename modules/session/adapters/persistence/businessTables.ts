import { bigint, boolean, primaryKey, text, timestamp } from 'drizzle-orm/pg-core';
import type { RunnerBusinessEvent, RunnerBusinessReceipt } from '@crewstation/contracts';
import { jsonDocument } from '@crewstation/persistence';
import { sessionSchema } from './schema';

export const businessExecutions = sessionSchema.table('business_executions', {
  taskId: text('task_id').notNull(), executionId: text('execution_id').notNull(),
  receipt: jsonDocument('receipt').$type<RunnerBusinessReceipt>().notNull(),
  persistedThrough: bigint('persisted_through', { mode: 'number' }).notNull().default(0),
  acknowledgedThrough: bigint('acknowledged_through', { mode: 'number' }).notNull().default(0),
  outputBytes: bigint('output_bytes', { mode: 'number' }).notNull().default(0),
  complete: boolean('complete').notNull().default(false),
  consumedAt: timestamp('consumed_at', { withTimezone: true }), expired: boolean('expired').notNull().default(false),
  polledAt: timestamp('polled_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => [primaryKey({ columns: [t.taskId, t.executionId] })]);

export const businessExecutionEvents = sessionSchema.table('business_execution_events', {
  taskId: text('task_id').notNull(), executionId: text('execution_id').notNull(),
  sequence: bigint('sequence', { mode: 'number' }).notNull(),
  digest: text('digest').notNull(), event: jsonDocument('event').$type<RunnerBusinessEvent>().notNull(),
}, (t) => [primaryKey({ columns: [t.taskId, t.executionId, t.sequence] })]);
