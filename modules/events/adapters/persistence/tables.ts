import { integer, text, timestamp, uniqueIndex } from 'drizzle-orm/pg-core';
import { jsonDocument } from '@crewstation/persistence';
import { eventsSchema } from './schema';


export const producers = eventsSchema.table('producers', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  producer: text('producer').notNull().unique(),
  serviceId: text('service_id').notNull(),
  projectId: text('project_id').notNull(),
  projectSlug: text('project_slug').notNull(),
  serviceIdentity: text('service_identity').notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull(),
});

export const eventTypes = eventsSchema.table('event_types', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  state: text('state').notNull(),
  eventType: text('event_type').notNull().unique(),
  producerId: text('producer_id').notNull(),
  producer: text('producer').notNull(),
  producerProject: text('producer_project').notNull(),
  schemaRef: text('schema_ref'),
});

export const subscriptions = eventsSchema.table('subscriptions', {
  id: text('id').primaryKey(),
  serviceId: text('service_id').notNull(),
  projectId: text('project_id').notNull(),
  eventTypeId: text('event_type_id').notNull(),
  eventType: text('event_type').notNull(),
  handlerPath: text('handler_path').notNull(),
  state: text('state').notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull(),
}, (t) => [uniqueIndex('subscriptions_service_event_idx').on(t.serviceId, t.eventTypeId)]);

export const inbox = eventsSchema.table('inbox', {
  id: text('id').primaryKey(),
  producerId: text('producer_id').notNull(),
  producer: text('producer').notNull(),
  producerProject: text('producer_project').notNull(),
  eventTypeId: text('event_type_id').notNull(),
  eventType: text('event_type').notNull(),
  dedupKey: text('dedup_key').notNull(),
  occurredAt: timestamp('occurred_at', { withTimezone: true }).notNull(),
  receivedAt: timestamp('received_at', { withTimezone: true }).notNull(),
  traceId: text('trace_id').notNull(),
  /** 生产方载荷；JSON null 以 SQL NULL 存储。 */
  payload: jsonDocument('payload'),
}, (t) => [uniqueIndex('inbox_dedup_idx').on(t.producerId, t.dedupKey)]);

export const deliveries = eventsSchema.table('deliveries', {
  id: text('id').primaryKey(),
  eventId: text('event_id').notNull(),
  subscriptionId: text('subscription_id').notNull(),
  serviceId: text('service_id').notNull(),
  projectId: text('project_id').notNull(),
  eventTypeId: text('event_type_id').notNull(),
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
