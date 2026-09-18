import { text, uniqueIndex, index } from 'drizzle-orm/pg-core';
import { jsonDocument } from '@crewstation/persistence';
import type { NativeTerminalRecord, ProfileRevisionRef, StartNativeTerminalRequest, TerminalSnapshot } from '@crewstation/contracts';
import type { NativeTerminalStart } from '../../ports/nativeTerminals';
import { devSessionSchema } from './schema';

export const nativeTerminalStarts = devSessionSchema.table('native_terminal_starts', {
  agentId: text('agent_id').primaryKey(), taskId: text('task_id').notNull(), createdBy: text('created_by').notNull(),
  clientRequestId: text('client_request_id').notNull(), fingerprint: text('fingerprint').notNull(),
  input: jsonDocument('input').$type<StartNativeTerminalRequest>().notNull(),
  /** RFC-006：受理时固定的档位修订（断代：之前的 driver／model／runtime 三列已删除）。 */
  profile: jsonDocument('profile').$type<ProfileRevisionRef>(),
  record: jsonDocument('record').$type<NativeTerminalRecord>().notNull(),
  execution: jsonDocument('execution').$type<NativeTerminalStart['execution']>(), executionTaskId: text('execution_task_id'),
  snapshot: jsonDocument('snapshot').$type<TerminalSnapshot>(),
}, (t) => [uniqueIndex('native_terminal_request').on(t.taskId, t.createdBy, t.clientRequestId), index('native_terminal_task').on(t.taskId), uniqueIndex('native_terminal_execution').on(t.executionTaskId)]);
