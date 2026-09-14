import type { DeliveryState, EventId, ProjectId, ServiceId, TraceId } from '@crewstation/contracts';
import type { Executor } from '@crewstation/persistence';
import { and, desc, eq } from 'drizzle-orm';
import type { Delivery } from '../../domain/delivery';
import type { InboxEvent } from '../../domain/inboxEvent';
import type { DeliveryRepository, InboxRepository } from '../../ports/repositories';
import { deliveries, inbox } from './tables';

export function drizzleInboxRepository(db: Executor): InboxRepository {
  return {
    insert: async (event) => {
      const rows = await db.insert(inbox).values({ ...event }).onConflictDoNothing({ target: [inbox.producer, inbox.dedupKey] }).returning({ id: inbox.id });
      return rows.length === 1;
    },
    getById: async (id) => {
      const row = (await db.select().from(inbox).where(eq(inbox.id, id)))[0];
      return row ? toInboxEvent(row) : undefined;
    },
    getByDedup: async (producer, dedupKey) => {
      const row = (await db.select().from(inbox).where(and(eq(inbox.producer, producer), eq(inbox.dedupKey, dedupKey))))[0];
      return row ? toInboxEvent(row) : undefined;
    },
  };
}

export function drizzleDeliveryRepository(db: Executor, lockForUpdate = false): DeliveryRepository {
  return {
    insert: async (delivery) => { await db.insert(deliveries).values(toDeliveryRow(delivery)); },
    update: async (delivery) => { await db.update(deliveries).set(toDeliveryRow(delivery)).where(eq(deliveries.id, delivery.id)); },
    getById: async (id) => {
      const query = db.select().from(deliveries).where(eq(deliveries.id, id));
      const row = (await (lockForUpdate ? query.for('update') : query))[0];
      return row ? toDelivery(row) : undefined;
    },
    listByProject: async (projectId, state, limit) => {
      const where = state === undefined ? eq(deliveries.projectId, projectId) : and(eq(deliveries.projectId, projectId), eq(deliveries.state, state));
      return (await db.select().from(deliveries).where(where).orderBy(desc(deliveries.createdAt), deliveries.id).limit(limit)).map(toDelivery);
    },
  };
}

function toInboxEvent(row: typeof inbox.$inferSelect): InboxEvent {
  return { ...row, id: row.id as EventId, traceId: row.traceId as TraceId, payload: row.payload ?? null };
}

function toDelivery(row: typeof deliveries.$inferSelect): Delivery {
  return {
    id: row.id, eventId: row.eventId as EventId, subscriptionId: row.subscriptionId, serviceId: row.serviceId as ServiceId,
    projectId: row.projectId as ProjectId, eventType: row.eventType, state: row.state as DeliveryState, attempts: row.attempts,
    ...(row.nextAttemptAt ? { nextAttemptAt: row.nextAttemptAt } : {}), ...(row.lastError === null ? {} : { lastError: row.lastError }),
    traceId: row.traceId as TraceId, ...(row.deliveredAt ? { deliveredAt: row.deliveredAt } : {}), createdAt: row.createdAt, updatedAt: row.updatedAt,
  };
}

function toDeliveryRow(delivery: Delivery): typeof deliveries.$inferInsert {
  return {
    id: delivery.id, eventId: delivery.eventId, subscriptionId: delivery.subscriptionId, serviceId: delivery.serviceId, projectId: delivery.projectId,
    eventType: delivery.eventType, state: delivery.state, attempts: delivery.attempts, nextAttemptAt: delivery.nextAttemptAt ?? null,
    lastError: delivery.lastError ?? null, traceId: delivery.traceId, deliveredAt: delivery.deliveredAt ?? null, createdAt: delivery.createdAt, updatedAt: delivery.updatedAt,
  };
}
