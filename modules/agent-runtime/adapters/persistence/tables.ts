import { boolean, index, integer, primaryKey, text, timestamp, uniqueIndex } from 'drizzle-orm/pg-core';
import { jsonDocument } from '@crewstation/persistence';
import type { RuntimeCheckContext, RuntimeCheckStage } from '@crewstation/contracts';
import type { RuntimeRevisionContent } from '../../domain/runtimeConfig';
import { agentRuntimeSchema } from './schema';

export const configs = agentRuntimeSchema.table('configs', {
  id: text('id').primaryKey(),
  name: text('name').notNull().unique(),
  description: text('description').notNull().default(''),
  driver: text('driver').notNull(),
  draftRevision: integer('draft_revision').notNull(),
  activeRevision: integer('active_revision'),
  enabled: boolean('enabled').notNull().default(true),
  createdBy: text('created_by').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull(),
  updatedBy: text('updated_by').notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull(),
});

export const revisions = agentRuntimeSchema.table('revisions', {
  configId: text('config_id').notNull(),
  revision: integer('revision').notNull(),
  content: jsonDocument('content').$type<RuntimeRevisionContent>().notNull(),
  contentHash: text('content_hash').notNull(),
  createdBy: text('created_by').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull(),
}, (t) => [primaryKey({ columns: [t.configId, t.revision] })]);

export const credentials = agentRuntimeSchema.table('credentials', {
  configId: text('config_id').notNull(),
  name: text('name').notNull(),
  cipherText: text('cipher_text').notNull(),
  updatedBy: text('updated_by').notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull(),
}, (t) => [primaryKey({ columns: [t.configId, t.name] })]);

export const checks = agentRuntimeSchema.table('checks', {
  checkId: text('check_id').primaryKey(),
  configId: text('config_id').notNull(),
  revision: integer('revision').notNull(),
  contentHash: text('content_hash').notNull(),
  clientRequestId: text('client_request_id').notNull(),
  createdBy: text('created_by').notNull(),
  model: text('model'),
  state: text('state').notNull(),
  context: jsonDocument('context').$type<RuntimeCheckContext>().notNull(),
  stages: jsonDocument('stages').$type<RuntimeCheckStage[]>().notNull(),
  error: text('error'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull(),
  startedAt: timestamp('started_at', { withTimezone: true }),
  endedAt: timestamp('ended_at', { withTimezone: true }),
}, (t) => [uniqueIndex('checks_request').on(t.configId, t.createdBy, t.clientRequestId), index('checks_config_revision').on(t.configId, t.revision, t.createdAt)]);
