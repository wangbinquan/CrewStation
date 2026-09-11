import { sql } from 'drizzle-orm';
import { customType, primaryKey, text, timestamp } from 'drizzle-orm/pg-core';
import { apiCatalogSchema } from './schema';

/**
 * drizzle 自带的 jsonb 会先 JSON.stringify 再交给 Bun SQL，后者对 jsonb 参数再编码一次，落库成 JSON 字符串；
 * 直接传对象则数字、布尔会带上驱动自己的类型而被 jsonb 列拒绝。这里以 text 参数传 JSON 文本、在库内 ::jsonb 解析，
 * 任何 JSON 值都能原样落库（SQL 侧可直接取字段）。drizzle 对 JS null 不调用 toDriver，落为 SQL NULL。
 */
const jsonDocument = customType<{ data: unknown; driverData: unknown }>({
  dataType: () => 'jsonb',
  toDriver: (value) => sql`${JSON.stringify(value)}::text::jsonb`,
  fromDriver: (value) => value,
});

export const proxies = apiCatalogSchema.table('proxies', {
  proxy: text('proxy').primaryKey(),
  projectId: text('project_id').notNull(),
  serviceId: text('service_id').notNull(),
  kind: text('kind').notNull(),
  upstreamConnection: text('upstream_connection'),
  document: jsonDocument('document').notNull(),
  state: text('state').notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull(),
});

export const operations = apiCatalogSchema.table('operations', {
  key: text('key').primaryKey(),
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
  operationKey: text('operation_key').notNull(),
  state: text('state').notNull(),
  grantedBy: text('granted_by').notNull(),
  grantedAt: timestamp('granted_at', { withTimezone: true }).notNull(),
  revokedAt: timestamp('revoked_at', { withTimezone: true }),
}, (t) => [primaryKey({ columns: [t.serviceId, t.operationKey] })]);

export const requests = apiCatalogSchema.table('requests', {
  id: text('id').primaryKey(),
  serviceId: text('service_id').notNull(),
  projectId: text('project_id').notNull(),
  operationKey: text('operation_key').notNull(),
  state: text('state').notNull(),
  reason: text('reason'),
  requestedBy: text('requested_by').notNull(),
  decidedBy: text('decided_by'),
  decision: text('decision'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull(),
  decidedAt: timestamp('decided_at', { withTimezone: true }),
});
