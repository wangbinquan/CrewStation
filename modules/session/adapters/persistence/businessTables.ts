import { bigint, boolean, index, integer, primaryKey, text, timestamp } from 'drizzle-orm/pg-core';
import type { RunnerBusinessEvent, RunnerBusinessReceipt, RunnerUsageCapture } from '@crewstation/contracts';
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

export const businessUsageSources = sessionSchema.table('business_usage_sources', {
  taskId: text('task_id').notNull(), executionId: text('execution_id').notNull(),
  attempt: integer('attempt').notNull(), incarnation: text('incarnation').notNull(), payloadDigest: text('payload_digest').notNull(),
  acknowledgedThrough: bigint('acknowledged_through', { mode: 'number' }).notNull().default(0),
  offeredThrough: bigint('offered_through', { mode: 'number' }).notNull().default(0),
  polledAt: timestamp('polled_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => [primaryKey({ columns: [t.taskId, t.executionId] }), index('business_usage_sources_poll').on(t.polledAt, t.taskId, t.executionId)]);

export const businessUsageEvents = sessionSchema.table('business_usage_events', {
  taskId: text('task_id').notNull(), executionId: text('execution_id').notNull(), sequence: bigint('sequence', { mode: 'number' }).notNull(),
  agentId: text('agent_id').notNull(), occurredAt: text('occurred_at').notNull(),
  capture: jsonDocument('capture').$type<RunnerUsageCapture>().notNull(),
}, (t) => [primaryKey({ columns: [t.taskId, t.executionId, t.sequence] })]);
