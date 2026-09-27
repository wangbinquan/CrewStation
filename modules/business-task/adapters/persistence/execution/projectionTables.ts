import { boolean, integer, primaryKey, text, timestamp, uniqueIndex } from 'drizzle-orm/pg-core';
import { jsonDocument } from '@crewstation/persistence';
import type { BusinessEvent } from '@crewstation/contracts';
import { businessTaskSchema } from '../schema';

export const subtaskProjections = businessTaskSchema.table('subtask_projections', {
  sourceStopped: boolean('source_stopped').notNull().default(false),
  sourceConsumed: boolean('source_consumed').notNull().default(false),
  subtaskId: text('subtask_id').primaryKey(), sourceSequence: integer('source_sequence').notNull().default(0),
  stdout: text('stdout').notNull().default(''), stderr: text('stderr').notNull().default(''), truncated: boolean('truncated').notNull().default(false),
  complete: boolean('complete').notNull().default(false), polledAt: timestamp('polled_at', { withTimezone: true }).notNull().defaultNow(),
});
export const businessEvents = businessTaskSchema.table('execution_events', {
  serviceId: text('service_id').notNull(), taskId: text('task_id').notNull(), sequence: integer('sequence').notNull(),
  subtaskId: text('subtask_id'), sourceSequence: integer('source_sequence').notNull(), digest: text('digest').notNull(),
  event: jsonDocument('event').$type<BusinessEvent>().notNull(), createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => [primaryKey({ columns: [t.taskId, t.sequence] }), uniqueIndex('execution_event_source').on(t.subtaskId, t.sourceSequence)]);

export const executionLogs = businessTaskSchema.table('execution_logs', {
  taskId: text('task_id').primaryKey(), serviceId: text('service_id').notNull(), generation: integer('generation').notNull().default(1),
  highWatermark: integer('high_watermark').notNull().default(0), expired: boolean('expired').notNull().default(false),
  closedAt: timestamp('closed_at', { withTimezone: true }),
  taskState: text('task_state'), taskGeneration: integer('task_generation'), taskPolledAt: timestamp('task_polled_at', { withTimezone: true }),
});
