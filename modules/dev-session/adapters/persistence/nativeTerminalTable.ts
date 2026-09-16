import { text, uniqueIndex, index } from 'drizzle-orm/pg-core';
import { jsonDocument } from '@crewstation/persistence';
import type { NativeTerminalRecord, RuntimeRevisionRef, StartNativeTerminalRequest, TerminalSnapshot } from '@crewstation/contracts';
import type { NativeTerminalStart } from '../../ports/nativeTerminals';
import { devSessionSchema } from './schema';

export const nativeTerminalStarts = devSessionSchema.table('native_terminal_starts', {
  agentId: text('agent_id').primaryKey(), taskId: text('task_id').notNull(), createdBy: text('created_by').notNull(),
  clientRequestId: text('client_request_id').notNull(), fingerprint: text('fingerprint').notNull(),
  input: jsonDocument('input').$type<StartNativeTerminalRequest>().notNull(),
  driver: text('driver').$type<'claude-code' | 'opencode'>().notNull(), model: text('model').notNull(),
  runtime: jsonDocument('runtime').$type<RuntimeRevisionRef>(),
  record: jsonDocument('record').$type<NativeTerminalRecord>().notNull(),
  execution: jsonDocument('execution').$type<NativeTerminalStart['execution']>(), executionTaskId: text('execution_task_id'),
  snapshot: jsonDocument('snapshot').$type<TerminalSnapshot>(),
}, (t) => [uniqueIndex('native_terminal_request').on(t.taskId, t.createdBy, t.clientRequestId), index('native_terminal_task').on(t.taskId), uniqueIndex('native_terminal_execution').on(t.executionTaskId)]);
