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
