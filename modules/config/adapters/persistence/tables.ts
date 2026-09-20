import { boolean, integer, primaryKey, uniqueIndex, text, timestamp } from 'drizzle-orm/pg-core';
import { configSchema } from './schema';

/** 每 (project, env) 一行版本计数器；改动在它上面原子加一，串行化同一取值组的并发写。 */
export const valueSets = configSchema.table('value_sets', {
  projectId: text('project_id').notNull(),
  env: text('env').notNull(),
  currentVersion: integer('current_version').notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull(),
}, (t) => [primaryKey({ columns: [t.projectId, t.env] })]);

export const definitions = configSchema.table('definitions', {
  id: text('id').primaryKey(),
  projectId: text('project_id').notNull(),
  name: text('name').notNull(),
  bindingName: text('binding_name').notNull(),
}, (t) => [uniqueIndex('definitions_project_binding_idx').on(t.projectId, t.bindingName)]);

export const items = configSchema.table('items', {
  id: text('id').primaryKey(),
  definitionId: text('definition_id').notNull(),
  bindingName: text('binding_name').notNull(),
  projectId: text('project_id').notNull(),
  env: text('env').notNull(),
  name: text('name').notNull(),
  isSecret: boolean('is_secret').notNull(),
  value: text('value').notNull(),
  version: integer('version').notNull(),
  updatedBy: text('updated_by').notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull(),
}, (t) => [uniqueIndex('items_definition_env_idx').on(t.definitionId, t.env)]);

export const versions = configSchema.table('versions', {
  projectId: text('project_id').notNull(),
  env: text('env').notNull(),
  version: integer('version').notNull(),
  createdBy: text('created_by').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull(),
}, (t) => [primaryKey({ columns: [t.projectId, t.env, t.version] })]);

export const versionEntries = configSchema.table('version_entries', {
  itemId: text('item_id').notNull(),
  definitionId: text('definition_id').notNull(),
  bindingName: text('binding_name').notNull(),
  projectId: text('project_id').notNull(),
  env: text('env').notNull(),
  version: integer('version').notNull(),
  name: text('name').notNull(),
  isSecret: boolean('is_secret').notNull(),
  value: text('value').notNull(),
}, (t) => [primaryKey({ columns: [t.projectId, t.env, t.version, t.itemId] })]);
