import { integer, primaryKey, text, timestamp } from 'drizzle-orm/pg-core';
import { jsonDocument } from '@crewstation/persistence';
import { gatewaySchema } from './schema';

export const allowlists = gatewaySchema.table('allowlists', {
  version: integer('version').primaryKey(),
  document: jsonDocument('document').notNull(),
  generatedAt: timestamp('generated_at', { withTimezone: true }).notNull(),
});

export const podIdentities = gatewaySchema.table('pod_identities', {
  namespace: text('namespace').notNull(),
  podName: text('pod_name').notNull(),
  ip: text('ip').notNull(),
  project: text('project').notNull(),
  service: text('service').notNull(),
  workload: text('workload').notNull(),
  physicalSlot: text('physical_slot'),
  taskId: text('task_id'),
  version: integer('version').notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull(),
  deletedAt: timestamp('deleted_at', { withTimezone: true }),
}, (t) => [primaryKey({ columns: [t.namespace, t.podName] })]);

export const routes = gatewaySchema.table('routes', {
  serviceId: text('service_id').primaryKey(),
  serviceName: text('service_name').notNull(),
  routes: jsonDocument('routes').notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull(),
});

/** RFC-021：正式版本维护，每个服务最多一行；body 是开关、原因、预计恢复时间与临时指定的人。 */
export const serviceMaintenance = gatewaySchema.table('service_maintenance', {
  serviceId: text('service_id').primaryKey(),
  projectId: text('project_id').notNull(),
  body: jsonDocument('body').notNull(),
  revision: integer('revision').notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull(),
});

export const maintenanceEvents = gatewaySchema.table('maintenance_events', {
  id: text('id').primaryKey(),
  serviceId: text('service_id').notNull(),
  kind: text('kind').notNull(),
  actorUserId: text('actor_user_id').notNull(),
  at: timestamp('at', { withTimezone: true }).notNull(),
  body: jsonDocument('body').notNull(),
});

/** RFC-025 T10：限流策略，平台默认一行（scope 'platform'），项目覆盖每个项目最多一行（scope 为项目 ID）。 */
export const rateLimits = gatewaySchema.table('rate_limits', {
  scope: text('scope').primaryKey(),
  body: jsonDocument('body').notNull(),
  revision: integer('revision').notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull(),
  updatedBy: text('updated_by').notNull(),
});
