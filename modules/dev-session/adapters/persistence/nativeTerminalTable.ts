import { text, uniqueIndex, index } from 'drizzle-orm/pg-core';
import { jsonDocument } from '@crewstation/persistence';
import type { NativeTerminalRecord, StartNativeTerminalRequest } from '@crewstation/contracts';
import { devSessionSchema } from './schema';

export const nativeTerminalStarts = devSessionSchema.table('native_terminal_starts', {
  agentId: text('agent_id').primaryKey(), taskId: text('task_id').notNull(), createdBy: text('created_by').notNull(),
  clientRequestId: text('client_request_id').notNull(), fingerprint: text('fingerprint').notNull(),
  input: jsonDocument('input').$type<StartNativeTerminalRequest>().notNull(),
  driver: text('driver').$type<'claude-code' | 'opencode'>().notNull(), model: text('model').notNull(),
  record: jsonDocument('record').$type<NativeTerminalRecord>().notNull(),
}, (t) => [uniqueIndex('native_terminal_request').on(t.taskId, t.createdBy, t.clientRequestId), index('native_terminal_task').on(t.taskId)]);
