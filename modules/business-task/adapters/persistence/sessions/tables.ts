import { primaryKey, text } from 'drizzle-orm/pg-core';
import type { TaskId } from '@crewstation/contracts';
import { businessTaskSchema } from '../schema';
export const sessionHomes = businessTaskSchema.table('execution_session_homes', {
  sessionKey: text('session_key').$type<TaskId>().primaryKey(), serviceId: text('service_id').notNull(), taskId: text('task_id').$type<TaskId>().notNull(),
  volumeUid: text('volume_uid').notNull(), leaseExecutionId: text('lease_execution_id'), state: text('state').notNull(),
});
export const sessionAliases = businessTaskSchema.table('execution_sessions', {
  serviceId: text('service_id').notNull(), taskId: text('task_id').$type<TaskId>().notNull(), sessionId: text('session_id').notNull(),
  sessionKey: text('session_key').$type<TaskId>().notNull(), sourceExecutionId: text('source_execution_id').notNull(),
}, (t) => [primaryKey({ columns: [t.taskId, t.sessionId] })]);
