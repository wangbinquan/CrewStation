import { integer, jsonb, text, timestamp } from 'drizzle-orm/pg-core';
import { businessTaskSchema } from './schema';

export const tasks = businessTaskSchema.table('tasks', {
  id: text('id').primaryKey(),
  serviceId: text('service_id').notNull(),
  projectId: text('project_id').notNull(),
  callerIdentity: text('caller_identity').notNull(),
  state: text('state').notNull(),
  traceId: text('trace_id').notNull(),
  volumeMode: text('volume_mode').notNull(),
  profile: text('profile').notNull(),
  labels: jsonb('labels').notNull(),
  message: text('message'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull(),
  closedAt: timestamp('closed_at', { withTimezone: true }),
});

export const subtasks = businessTaskSchema.table('subtasks', {
  id: text('id').primaryKey(),
  taskId: text('task_id').notNull(),
  name: text('name').notNull(),
  kind: text('kind').notNull(),
  mode: text('mode'),
  state: text('state').notNull(),
  attempt: integer('attempt').notNull(),
  spec: jsonb('spec').notNull(),
  runnerRef: text('runner_ref'),
  sessionId: text('session_id'),
  exitCode: integer('exit_code'),
  output: text('output'),
  businessOutcome: text('business_outcome'),
  contractResult: jsonb('contract_result'),
  error: text('error'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull(),
  startedAt: timestamp('started_at', { withTimezone: true }),
  endedAt: timestamp('ended_at', { withTimezone: true }),
});

export const contracts = businessTaskSchema.table('contracts', {
  releaseId: text('release_id').primaryKey(),
  serviceId: text('service_id').notNull(),
  tag: text('tag').notNull(),
  agentProfiles: jsonb('agent_profiles').notNull(),
  outputContracts: jsonb('output_contracts').notNull(),
  registeredAt: timestamp('registered_at', { withTimezone: true }).notNull(),
});
