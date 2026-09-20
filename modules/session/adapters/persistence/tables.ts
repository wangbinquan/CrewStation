import { integer, primaryKey, text, timestamp } from 'drizzle-orm/pg-core';
import { jsonDocument } from '@crewstation/persistence';
import { sessionSchema } from './schema';

export const runnerEvents = sessionSchema.table('runner_events', {
  taskId: text('task_id').notNull(),
  seq: integer('seq').notNull(),
  at: timestamp('at', { withTimezone: true }).notNull(),
  kind: text('kind').notNull(),
  agentId: text('agent_id'),
  event: jsonDocument('event').notNull(),
  legacyEvent: jsonDocument('legacy_event'),
  identityProvenance: jsonDocument('identity_provenance'),
}, (t) => [primaryKey({ columns: [t.taskId, t.seq] })]);

export const connections = sessionSchema.table('connections', {
  taskId: text('task_id').primaryKey(),
  replica: text('replica').notNull(),
  connectedAt: timestamp('connected_at', { withTimezone: true }).notNull(),
  lastSeenAt: timestamp('last_seen_at', { withTimezone: true }).notNull(),
});
