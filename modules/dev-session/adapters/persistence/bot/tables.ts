import { index, integer, text, uniqueIndex } from 'drizzle-orm/pg-core';
import { jsonDocument } from '@crewstation/persistence';
import type { BotConversation, BotExecution, BotOperation } from '../../../ports/botConversations';
import { devSessionSchema } from '../schema';

export const conversations = devSessionSchema.table('bot_conversations', {
  taskId: text('task_id').primaryKey(), id: text('id').notNull().unique(), revision: integer('revision').notNull(),
  data: jsonDocument('data').$type<BotConversation>().notNull(),
});
export const operations = devSessionSchema.table('bot_messages', {
  taskId: text('task_id').notNull(), requestId: text('request_id').notNull(), state: text('state').notNull(),
  data: jsonDocument('data').$type<BotOperation>().notNull(),
}, (t) => [uniqueIndex('bot_messages_request').on(t.taskId, t.requestId), index('bot_messages_pending').on(t.taskId, t.state)]);
export const executions = devSessionSchema.table('bot_executions', {
  agentId: text('agent_id').primaryKey(), taskId: text('task_id').notNull(), executionTaskId: text('execution_task_id').notNull().unique(),
  data: jsonDocument('data').$type<BotExecution>().notNull(),
}, (t) => [index('bot_executions_task').on(t.taskId, t.agentId)]);
