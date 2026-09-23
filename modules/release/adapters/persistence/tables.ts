import type { SlotMaintenance } from '../../domain/slotMaintenance';
import { integer, text, timestamp, uniqueIndex } from 'drizzle-orm/pg-core';
import { jsonDocument } from '@crewstation/persistence';
import { releaseSchema } from './schema';

export const releases = releaseSchema.table('releases', {
  legacyResourceId: text('legacy_resource_id'),
  id: text('id').primaryKey(),
  serviceId: text('service_id').notNull(),
  projectId: text('project_id').notNull(),
  tag: text('tag').notNull(),
  commitSha: text('commit_sha').notNull(),
  branch: text('branch').notNull(),
  status: text('status').notNull(),
  targetSlot: text('target_slot').notNull(),
  image: text('image'),
  manifest: jsonDocument('manifest'),
  configVersion: integer('config_version'),
  pipeline: jsonDocument('pipeline').notNull(),
  message: text('message'),
  createdBy: text('created_by').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull(),
}, (t) => [uniqueIndex('releases_service_tag_idx').on(t.serviceId, t.tag)]);

export const serviceSlots = releaseSchema.table('service_slots', {
  serviceId: text('service_id').primaryKey(),
  active: text('active').notNull(),
  blue: jsonDocument('blue').notNull(),
  green: jsonDocument('green').notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull(),
});

export const trafficSwitches = releaseSchema.table('traffic_switches', {
  id: text('id').primaryKey(),
  serviceId: text('service_id').notNull(),
  fromSlot: text('from_slot').notNull(),
  toSlot: text('to_slot').notNull(),
  releaseId: text('release_id').notNull(),
  previousReleaseId: text('previous_release_id'),
  actorUserId: text('actor_user_id').notNull(),
  reason: text('reason'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull(),
});

export const replicaOverrides = releaseSchema.table('replica_overrides', { serviceId: text('service_id').notNull(), physical: text('physical').notNull(), replicas: integer('replicas').notNull() }, (t) => [uniqueIndex('replica_overrides_slot').on(t.serviceId, t.physical)]);
export const slotMaintenance = releaseSchema.table('slot_maintenance', { id: text('id').primaryKey(), serviceId: text('service_id').notNull(), state: text('state').notNull(), body: jsonDocument('body').$type<SlotMaintenance>().notNull() });

/** RFC-021：待命槽的下线、重新部署、推迟与提醒记录，进发布时间线。 */
export const slotEvents = releaseSchema.table('slot_events', {
  id: text('id').primaryKey(),
  serviceId: text('service_id').notNull(),
  kind: text('kind').notNull(),
  releaseId: text('release_id').notNull(),
  tag: text('tag').notNull(),
  reason: text('reason'),
  actorUserId: text('actor_user_id'),
  deadline: timestamp('deadline', { withTimezone: true }),
  at: timestamp('at', { withTimezone: true }).notNull(),
});

/** RFC-021：平台统一的自动下线时长；只有一行（id = 'platform'），没有这一行时用默认值。 */
export const offlinePolicy = releaseSchema.table('offline_policy', {
  id: text('id').primaryKey(),
  rollbackRetentionHours: integer('rollback_retention_hours').notNull(),
  idleOfflineDays: integer('idle_offline_days').notNull(),
  reminderLeadHours: integer('reminder_lead_hours').notNull(),
  revision: integer('revision').notNull(),
  updatedBy: text('updated_by'),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull(),
});
