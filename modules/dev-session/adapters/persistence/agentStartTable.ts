import { boolean, index, integer, text, uniqueIndex } from 'drizzle-orm/pg-core';
import { jsonDocument } from '@crewstation/persistence';
import type { AgentStart } from '../../ports/agentStarts';
import { devSessionSchema } from './schema';

export const clusterAgentRestarts = devSessionSchema.table('cluster_agent_restarts', {
  operationId: text('operation_id').primaryKey(), agentId: text('agent_id').notNull().unique(), taskId: text('task_id').notNull().unique(),
});

/** headless Agent 的受理记录（RFC-006）：一行一个 Agent，执行环境 ID 唯一。 */
export const agentStarts = devSessionSchema.table('agent_starts', {
  agentId: text('agent_id').primaryKey(),
  taskId: text('task_id').notNull(),
  createdBy: text('created_by').notNull(),
  compute: text('compute').notNull(),
  computeName: text('compute_name'),
  profile: jsonDocument('profile').$type<AgentStart['profile']>().notNull(),
  permission: text('permission').notNull(),
  request: jsonDocument('request').$type<AgentStart['request']>().notNull(),
  execution: jsonDocument('execution').$type<AgentStart['execution']>().notNull(),
  executionTaskId: text('execution_task_id').notNull(),
  state: text('state').notNull(),
  failure: text('failure'),
  cancelled: boolean('cancelled').notNull().default(false),
  cursor: integer('cursor').notNull().default(0),
  finalized: boolean('finalized').notNull().default(false),
  createdAt: text('created_at').notNull(),
  dispatchedAt: text('dispatched_at'),
  endedAt: text('ended_at'),
}, (t) => [index('agent_starts_task').on(t.taskId), uniqueIndex('agent_starts_execution').on(t.executionTaskId)]);
