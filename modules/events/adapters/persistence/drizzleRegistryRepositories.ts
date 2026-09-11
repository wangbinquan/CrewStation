import type { ProjectId, ServiceId } from '@crewstation/contracts';
import type { Executor } from '@crewstation/persistence';
import { and, eq } from 'drizzle-orm';
import type { EventType } from '../../domain/producer';
import type { Subscription, SubscriptionState } from '../../domain/subscription';
import type { EventTypeRepository, ProducerRepository, SubscriptionRepository } from '../../ports/repositories';
import { eventTypes, producers, subscriptions } from './tables';

export function drizzleProducerRepository(db: Executor): ProducerRepository {
  return {
    upsert: async (producer) => {
      const row = { ...producer };
      await db.insert(producers).values(row).onConflictDoUpdate({ target: producers.producer, set: row });
    },
    getByName: async (name) => {
      const row = (await db.select().from(producers).where(eq(producers.producer, name)))[0];
      return row ? { ...row, serviceId: row.serviceId as ServiceId, projectId: row.projectId as ProjectId } : undefined;
    },
  };
}

export function drizzleEventTypeRepository(db: Executor): EventTypeRepository {
  return {
    getByEventType: async (eventType) => {
      const row = (await db.select().from(eventTypes).where(eq(eventTypes.eventType, eventType)))[0];
      return row ? toEventType(row) : undefined;
    },
    list: async () => (await db.select().from(eventTypes).orderBy(eventTypes.eventType)).map(toEventType),
    replaceForProducer: async (producer, types) => {
      await db.delete(eventTypes).where(eq(eventTypes.producer, producer));
      for (const type of types) {
        await db.insert(eventTypes).values({ eventType: type.eventType, producer: type.producer, producerProject: type.producerProject, schemaRef: type.schemaRef ?? null });
      }
    },
  };
}

export function drizzleSubscriptionRepository(db: Executor): SubscriptionRepository {
  return {
    getById: async (id) => {
      const row = (await db.select().from(subscriptions).where(eq(subscriptions.id, id)))[0];
      return row ? toSubscription(row) : undefined;
    },
    listByService: async (serviceId) => (await db.select().from(subscriptions).where(eq(subscriptions.serviceId, serviceId)).orderBy(subscriptions.eventType)).map(toSubscription),
    listByProject: async (projectId) => (await db.select().from(subscriptions).where(eq(subscriptions.projectId, projectId)).orderBy(subscriptions.eventType)).map(toSubscription),
    listActiveByEventType: async (eventType) => (await db.select().from(subscriptions)
      .where(and(eq(subscriptions.eventType, eventType), eq(subscriptions.state, 'active'))).orderBy(subscriptions.id)).map(toSubscription),
    upsert: async (subscription) => {
      const row = { ...subscription };
      await db.insert(subscriptions).values(row).onConflictDoUpdate({ target: subscriptions.id, set: row });
    },
    remove: async (id) => { await db.delete(subscriptions).where(eq(subscriptions.id, id)); },
  };
}

function toEventType(row: typeof eventTypes.$inferSelect): EventType {
  return { eventType: row.eventType, producer: row.producer, producerProject: row.producerProject, ...(row.schemaRef === null ? {} : { schemaRef: row.schemaRef }) };
}

function toSubscription(row: typeof subscriptions.$inferSelect): Subscription {
  return { ...row, serviceId: row.serviceId as ServiceId, projectId: row.projectId as ProjectId, state: row.state as SubscriptionState };
}
