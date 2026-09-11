import { integer, primaryKey, text, timestamp } from 'drizzle-orm/pg-core';
import { egressSchema } from './schema';

export const entries = egressSchema.table('entries', {
  id: text('id').primaryKey(),
  fqdn: text('fqdn').notNull(),
  scope: text('scope').notNull(),
  /** 全局条目为空字符串，便于 (fqdn, scope, project_id) 唯一约束覆盖两种作用域。 */
  projectId: text('project_id').notNull().default(''),
  note: text('note'),
  createdBy: text('created_by').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull(),
});

export const requests = egressSchema.table('requests', {
  id: text('id').primaryKey(),
  projectId: text('project_id').notNull(),
  fqdn: text('fqdn').notNull(),
  reason: text('reason'),
  state: text('state').notNull(),
  requestedBy: text('requested_by').notNull(),
  decidedBy: text('decided_by'),
  decision: text('decision'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull(),
  decidedAt: timestamp('decided_at', { withTimezone: true }),
});

export const blocked = egressSchema.table('blocked', {
  projectId: text('project_id').notNull(),
  fqdn: text('fqdn').notNull(),
  count: integer('count').notNull(),
  lastSeenAt: timestamp('last_seen_at', { withTimezone: true }).notNull(),
  source: text('source'),
}, (t) => [primaryKey({ columns: [t.projectId, t.fqdn] })]);
