import { integer, jsonb, text, timestamp, uniqueIndex } from 'drizzle-orm/pg-core';
import { releaseSchema } from './schema';

export const releases = releaseSchema.table('releases', {
  id: text('id').primaryKey(),
  serviceId: text('service_id').notNull(),
  projectId: text('project_id').notNull(),
  tag: text('tag').notNull(),
  commitSha: text('commit_sha').notNull(),
  branch: text('branch').notNull(),
  status: text('status').notNull(),
  targetSlot: text('target_slot').notNull(),
  image: text('image'),
  manifest: jsonb('manifest'),
  configVersion: integer('config_version'),
  pipeline: jsonb('pipeline').notNull(),
  message: text('message'),
  createdBy: text('created_by').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull(),
}, (t) => [uniqueIndex('releases_service_tag_idx').on(t.serviceId, t.tag)]);

export const serviceSlots = releaseSchema.table('service_slots', {
  serviceId: text('service_id').primaryKey(),
  active: text('active').notNull(),
  blue: jsonb('blue').notNull(),
  green: jsonb('green').notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull(),
});

export const trafficSwitches = releaseSchema.table('traffic_switches', {
  id: text('id').primaryKey(),
  serviceId: text('service_id').notNull(),
  fromSlot: text('from_slot').notNull(),
  toSlot: text('to_slot').notNull(),
  releaseId: text('release_id').notNull(),
  actorUserId: text('actor_user_id').notNull(),
  reason: text('reason'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull(),
});
