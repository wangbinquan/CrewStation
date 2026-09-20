import { primaryKey, text, timestamp } from 'drizzle-orm/pg-core';
import { jsonDocument } from '@crewstation/persistence';
import { apiCatalogSchema } from './schema';


export const proxies = apiCatalogSchema.table('proxies', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  proxy: text('proxy').notNull().unique(),
  projectId: text('project_id').notNull(),
  serviceId: text('service_id').notNull(),
  kind: text('kind').notNull(),
  upstreamConnection: text('upstream_connection'),
  document: jsonDocument('document').notNull(),
  state: text('state').notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull(),
});

export const operations = apiCatalogSchema.table('operations', {
  id: text('id').primaryKey(),
  proxyId: text('proxy_id').notNull(),
  proxy: text('proxy').notNull(),
  method: text('method').notNull(),
  path: text('path').notNull(),
  summary: text('summary'),
  openPolicy: text('open_policy').notNull(),
  resourceNote: text('resource_note'),
  state: text('state').notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull(),
});

export const grants = apiCatalogSchema.table('grants', {
  serviceId: text('service_id').notNull(),
  operationId: text('operation_id').notNull(),
  state: text('state').notNull(),
  grantedBy: text('granted_by').notNull(),
  grantedAt: timestamp('granted_at', { withTimezone: true }).notNull(),
  revokedAt: timestamp('revoked_at', { withTimezone: true }),
}, (t) => [primaryKey({ columns: [t.serviceId, t.operationId] })]);

export const requests = apiCatalogSchema.table('requests', {
  id: text('id').primaryKey(),
  serviceId: text('service_id').notNull(),
  projectId: text('project_id').notNull(),
  operationId: text('operation_id').notNull(),
  state: text('state').notNull(),
  reason: text('reason'),
  requestedBy: text('requested_by').notNull(),
  decidedBy: text('decided_by'),
  decision: text('decision'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull(),
  decidedAt: timestamp('decided_at', { withTimezone: true }),
});
