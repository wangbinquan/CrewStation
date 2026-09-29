import { bigint, boolean, index, primaryKey, text, timestamp } from 'drizzle-orm/pg-core';
import type { DevelopmentUsageClosure, DevelopmentUsageDrainReason, DevelopmentUsageEvent, DevelopmentUsageLoss, DevelopmentUsageReceipt, DevelopmentUsageRegistration } from '@crewstation/contracts';
import { jsonDocument } from '@crewstation/persistence';
import { sessionSchema } from './schema';

export const developmentUsageStreams = sessionSchema.table('development_usage_streams', {
  taskId: text('task_id').notNull(), registration: jsonDocument('registration').$type<DevelopmentUsageRegistration>().notNull(),
  receipt: jsonDocument('receipt').$type<DevelopmentUsageReceipt>(),
  persistedThrough: bigint('persisted_through', { mode: 'number' }).notNull().default(0),
  runnerAcknowledgedThrough: bigint('runner_acknowledged_through', { mode: 'number' }).notNull().default(0),
  sourceAcknowledgedThrough: bigint('source_acknowledged_through', { mode: 'number' }).notNull().default(0),
  offeredThrough: bigint('offered_through', { mode: 'number' }).notNull().default(0),
  complete: boolean('complete').notNull().default(false), drainReason: text('drain_reason').$type<DevelopmentUsageDrainReason>(),
  loss: jsonDocument('loss').$type<DevelopmentUsageLoss>(), closure: jsonDocument('closure').$type<DevelopmentUsageClosure>(),
  polledAt: timestamp('polled_at', { withTimezone: true }).notNull().defaultNow(),
  sourcePolledAt: timestamp('source_polled_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => [primaryKey({ columns: [t.taskId] }), index('development_usage_poll').on(t.polledAt, t.taskId), index('development_usage_source_poll').on(t.sourcePolledAt, t.taskId)]);
export const developmentUsageEvents = sessionSchema.table('development_usage_events', {
  taskId: text('task_id').notNull(), sequence: bigint('sequence', { mode: 'number' }).notNull(),
  digest: text('digest').notNull(), event: jsonDocument('event').$type<DevelopmentUsageEvent>().notNull(),
}, (t) => [primaryKey({ columns: [t.taskId, t.sequence] })]);
