import { bigint, boolean, index, integer, pgSchema, primaryKey, text, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';

/** 本模块唯一允许使用的 PostgreSQL schema；所有表都定义在它之下。 */
export const observabilitySchema = pgSchema('observability');

export const alerts = observabilitySchema.table('alerts', {
  id: text('id').primaryKey(),
  projectId: text('project_id').notNull(),
  type: text('type').notNull(),
  key: text('key').notNull(),
  state: text('state').notNull(),
  detail: text('detail').notNull(),
  firedAt: timestamp('fired_at', { withTimezone: true }).notNull(),
  resolvedAt: timestamp('resolved_at', { withTimezone: true }),
});

// RFC-034 v2 §3：一次 Agent 执行一行，原地更新；按实际模型拆分的用量整组替换。
const tokens = (name: string) => bigint(name, { mode: 'number' }).notNull().default(0);

export const agentCalls = observabilitySchema.table('agent_calls', {
  id: uuid('id').primaryKey(),
  projectId: text('project_id'),
  source: text('source').$type<'business' | 'development' | 'platform'>().notNull(),
  kind: text('kind').$type<'subtask' | 'agent' | 'cli' | 'profile-test'>().notNull(),
  taskId: text('task_id').notNull(),
  taskLabel: text('task_label').notNull(),
  subtaskId: text('subtask_id'),
  attempt: integer('attempt'),
  runtimeTaskId: text('runtime_task_id').notNull(),
  agentId: text('agent_id').notNull(),
  agentKey: text('agent_key').notNull(),
  agentLabel: text('agent_label').notNull(),
  profileId: text('profile_id').notNull(),
  profileRevision: integer('profile_revision'),
  profileName: text('profile_name'),
  protocol: text('protocol').notNull(),
  status: text('status').$type<'running' | 'done' | 'failed' | 'canceled' | 'interrupted'>().notNull().default('running'),
  startedAt: timestamp('started_at', { withTimezone: true }).notNull(),
  endedAt: timestamp('ended_at', { withTimezone: true }),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull(),
  usageState: text('usage_state').$type<'pending' | 'partial' | 'complete' | 'none'>().notNull().default('pending'),
  inputTokens: tokens('input_tokens'),
  cacheReadTokens: tokens('cache_read_tokens'),
  cacheWriteTokens: tokens('cache_write_tokens'),
  outputTokens: tokens('output_tokens'),
  reasoningTokens: tokens('reasoning_tokens'),
  costNano: bigint('cost_nano', { mode: 'bigint' }).notNull().default(sql`0`),
  costState: text('cost_state').$type<'none' | 'priced' | 'partial' | 'unpriced'>().notNull().default('none'),
}, (t) => [
  index('agent_calls_started').on(t.startedAt, t.id),
  index('agent_calls_project_started').on(t.projectId, t.startedAt),
  index('agent_calls_task_started').on(t.taskId, t.startedAt),
  uniqueIndex('agent_calls_running_agent').on(t.runtimeTaskId, t.agentId).where(sql`status = 'running'`),
]);

export const agentCallModels = observabilitySchema.table('agent_call_models', {
  callId: uuid('call_id').notNull().references(() => agentCalls.id, { onDelete: 'cascade' }),
  model: text('model').notNull(),
  inputTokens: tokens('input_tokens'),
  cacheReadTokens: tokens('cache_read_tokens'),
  cacheWriteTokens: tokens('cache_write_tokens'),
  outputTokens: tokens('output_tokens'),
  reasoningTokens: tokens('reasoning_tokens'),
  priceId: uuid('price_id'),
  costNano: bigint('cost_nano', { mode: 'bigint' }),
  costState: text('cost_state').$type<'none' | 'priced' | 'partial' | 'unpriced'>().notNull(),
}, (t) => [primaryKey({ columns: [t.callId, t.model] })]);

/** 只追加的人民币价格线：费率为微元 / 百万 Token，null 为未知（不是免费）。 */
export const priceVersions = observabilitySchema.table('price_versions', {
  id: uuid('id').primaryKey(),
  profileId: text('profile_id').notNull(),
  model: text('model').notNull(),
  inputMicro: bigint('input_micro', { mode: 'number' }),
  cacheReadMicro: bigint('cache_read_micro', { mode: 'number' }),
  cacheWriteMicro: bigint('cache_write_micro', { mode: 'number' }),
  outputMicro: bigint('output_micro', { mode: 'number' }),
  effectiveFrom: timestamp('effective_from', { withTimezone: true }).notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull(),
  createdBy: text('created_by').notNull(),
  note: text('note').notNull().default(''),
}, (t) => [index('price_versions_line').on(t.profileId, t.model, t.createdAt)]);

/** 项目页与项目成员是否看得到人民币；没有行即不可见。 */
export const projectCostVisibility = observabilitySchema.table('project_cost_visibility', {
  projectId: text('project_id').primaryKey(),
  visible: boolean('visible').notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull(),
  updatedBy: text('updated_by').notNull(),
});
