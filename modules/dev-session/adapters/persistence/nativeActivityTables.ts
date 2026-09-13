import { bigint, index, primaryKey, text, uniqueIndex } from 'drizzle-orm/pg-core';
import type { AgentActivityItem } from '@crewstation/contracts';
import { jsonDocument } from '@crewstation/persistence';
import type { NativeActivityProjection } from '../../domain/nativeActivityProjection';
import { devSessionSchema } from './schema';

export const activityProgress = devSessionSchema.table('native_activity_progress', {
  taskId: text('task_id').primaryKey(), throughSeq: bigint('through_seq', { mode: 'number' }).notNull().default(0),
  prunedThroughSeq: bigint('pruned_through_seq', { mode: 'number' }).notNull().default(0),
});
export const activityStates = devSessionSchema.table('native_activity_states', {
  taskId: text('task_id').notNull(), agentId: text('agent_id').notNull(),
  projection: jsonDocument('projection').$type<NativeActivityProjection>().notNull(),
}, (table) => [primaryKey({ columns: [table.taskId, table.agentId] })]);
export const activityItems = devSessionSchema.table('native_activity_items', {
  taskId: text('task_id').notNull(), seq: bigint('seq', { mode: 'number' }).notNull(),
  eventId: text('event_id').notNull(), agentId: text('agent_id').notNull(), turnId: text('turn_id'), kind: text('kind').notNull(),
  item: jsonDocument('item').$type<AgentActivityItem>().notNull(),
}, (table) => [primaryKey({ columns: [table.taskId, table.seq] }), uniqueIndex('native_activity_event').on(table.taskId, table.eventId), index('native_activity_turn').on(table.taskId, table.agentId, table.turnId, table.seq)]);
export const activityReads = devSessionSchema.table('native_activity_reads', {
  taskId: text('task_id').notNull(), userId: text('user_id').notNull(), agentId: text('agent_id').notNull(), turnId: text('turn_id').notNull(),
  throughSeq: bigint('through_seq', { mode: 'number' }).notNull(),
}, (table) => [primaryKey({ columns: [table.taskId, table.userId, table.agentId, table.turnId] })]);
