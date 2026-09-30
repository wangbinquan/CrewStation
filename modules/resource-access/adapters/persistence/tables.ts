import { integer, text, timestamp, uniqueIndex } from 'drizzle-orm/pg-core';
import { jsonDocument } from '@crewstation/persistence';
import type { ResourceChange } from '../../domain/change';
import { resourceAccessSchema } from './schema';

export const changes = resourceAccessSchema.table('changes', {
  id: text('id').primaryKey(), projectId: text('project_id').notNull(), actorId: text('actor_id').notNull(),
  key: text('request_key').notNull(), targetKey: text('target_key').notNull(), state: text('state').notNull(),
  version: integer('version').notNull(), body: jsonDocument('body').$type<ResourceChange>().notNull(), createdAt: timestamp('created_at', { withTimezone: true }).notNull(),
}, (t) => [uniqueIndex('changes_request_key').on(t.projectId, t.actorId, t.key)]);
export const catalogPolicies = resourceAccessSchema.table('catalog_policies', {
  key: text('key').primaryKey(), resourceType: text('resource_type').notNull(), resourceId: text('resource_id').notNull(),
  requestable: integer('requestable').notNull(), revision: integer('revision').notNull(), actorId: text('actor_id').notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull(),
});
