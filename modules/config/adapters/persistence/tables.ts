import { boolean, integer, primaryKey, text, timestamp } from 'drizzle-orm/pg-core';
import { configSchema } from './schema';

/** 每 (project, env) 一行版本计数器；改动在它上面原子加一，串行化同一取值组的并发写。 */
export const valueSets = configSchema.table('value_sets', {
  projectId: text('project_id').notNull(),
  env: text('env').notNull(),
  currentVersion: integer('current_version').notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull(),
}, (t) => [primaryKey({ columns: [t.projectId, t.env] })]);

export const items = configSchema.table('items', {
  projectId: text('project_id').notNull(),
  env: text('env').notNull(),
  name: text('name').notNull(),
  isSecret: boolean('is_secret').notNull(),
  value: text('value').notNull(),
  version: integer('version').notNull(),
  updatedBy: text('updated_by').notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull(),
}, (t) => [primaryKey({ columns: [t.projectId, t.env, t.name] })]);

export const versions = configSchema.table('versions', {
  projectId: text('project_id').notNull(),
  env: text('env').notNull(),
  version: integer('version').notNull(),
  createdBy: text('created_by').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull(),
}, (t) => [primaryKey({ columns: [t.projectId, t.env, t.version] })]);

export const versionEntries = configSchema.table('version_entries', {
  projectId: text('project_id').notNull(),
  env: text('env').notNull(),
  version: integer('version').notNull(),
  name: text('name').notNull(),
  isSecret: boolean('is_secret').notNull(),
  value: text('value').notNull(),
}, (t) => [primaryKey({ columns: [t.projectId, t.env, t.version, t.name] })]);
