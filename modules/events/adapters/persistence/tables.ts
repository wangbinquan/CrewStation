import { sql } from 'drizzle-orm';
import { customType, integer, text, timestamp, uniqueIndex } from 'drizzle-orm/pg-core';
import { eventsSchema } from './schema';

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

export const producers = eventsSchema.table('producers', {
  producer: text('producer').primaryKey(),
  serviceId: text('service_id').notNull(),
  projectId: text('project_id').notNull(),
  projectSlug: text('project_slug').notNull(),
  serviceIdentity: text('service_identity').notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull(),
});

export const eventTypes = eventsSchema.table('event_types', {
  eventType: text('event_type').primaryKey(),
  producer: text('producer').notNull(),
  producerProject: text('producer_project').notNull(),
  schemaRef: text('schema_ref'),
});

export const subscriptions = eventsSchema.table('subscriptions', {
  id: text('id').primaryKey(),
  serviceId: text('service_id').notNull(),
  projectId: text('project_id').notNull(),
  eventType: text('event_type').notNull(),
  handlerPath: text('handler_path').notNull(),
  state: text('state').notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull(),
}, (t) => [uniqueIndex('subscriptions_service_event_idx').on(t.serviceId, t.eventType)]);

export const inbox = eventsSchema.table('inbox', {
  id: text('id').primaryKey(),
  producer: text('producer').notNull(),
  producerProject: text('producer_project').notNull(),
  eventType: text('event_type').notNull(),
  dedupKey: text('dedup_key').notNull(),
  occurredAt: timestamp('occurred_at', { withTimezone: true }).notNull(),
  receivedAt: timestamp('received_at', { withTimezone: true }).notNull(),
  traceId: text('trace_id').notNull(),
  /** 生产方载荷；JSON null 以 SQL NULL 存储。 */
  payload: jsonDocument('payload'),
}, (t) => [uniqueIndex('inbox_dedup_idx').on(t.producer, t.dedupKey)]);

export const deliveries = eventsSchema.table('deliveries', {
  id: text('id').primaryKey(),
  eventId: text('event_id').notNull(),
  subscriptionId: text('subscription_id').notNull(),
  serviceId: text('service_id').notNull(),
  projectId: text('project_id').notNull(),
  eventType: text('event_type').notNull(),
  state: text('state').notNull(),
  attempts: integer('attempts').notNull(),
  nextAttemptAt: timestamp('next_attempt_at', { withTimezone: true }),
  lastError: text('last_error'),
  traceId: text('trace_id').notNull(),
  deliveredAt: timestamp('delivered_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull(),
});
