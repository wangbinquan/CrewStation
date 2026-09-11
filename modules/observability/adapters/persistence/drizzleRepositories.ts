import type { AlertType, ProjectId, UserId } from '@crewstation/contracts';
import type { Executor } from '@crewstation/persistence';
import { and, desc, eq } from 'drizzle-orm';
import type { AlertRecord, AlertRepository, AlertSubscriptionRepository, SubscriptionRecord } from '../../ports/repositories';
import { alertSubscriptions, alerts } from './tables';

export function drizzleAlertRepository(db: Executor): AlertRepository {
  const toRecord = (r: typeof alerts.$inferSelect): AlertRecord => ({ id: r.id, projectId: r.projectId as ProjectId, type: r.type as AlertType, key: r.key, state: r.state as 'firing' | 'resolved', detail: r.detail, firedAt: r.firedAt, ...(r.resolvedAt ? { resolvedAt: r.resolvedAt } : {}) });
  return {
    firing: async (projectId) => (await db.select().from(alerts).where(and(eq(alerts.projectId, projectId), eq(alerts.state, 'firing')))).map(toRecord),
    list: async (projectId, limit) => (await db.select().from(alerts).where(eq(alerts.projectId, projectId)).orderBy(desc(alerts.firedAt)).limit(limit)).map(toRecord),
    fire: async (a) => { await db.insert(alerts).values({ ...a, resolvedAt: a.resolvedAt ?? null }); },
    resolve: async (projectId, key, at) => (await db.update(alerts).set({ state: 'resolved', resolvedAt: at }).where(and(eq(alerts.projectId, projectId), eq(alerts.key, key), eq(alerts.state, 'firing'))).returning()).map(toRecord),
  };
}

export function drizzleAlertSubscriptionRepository(db: Executor): AlertSubscriptionRepository {
  const toRecord = (r: typeof alertSubscriptions.$inferSelect): SubscriptionRecord => ({ projectId: r.projectId as ProjectId, userId: r.userId as UserId, channel: r.channel as 'workbench' | 'webhook', ...(r.target ? { target: r.target } : {}) });
  return {
    list: async (projectId) => (await db.select().from(alertSubscriptions).where(eq(alertSubscriptions.projectId, projectId))).map(toRecord),
    upsert: async (s) => { await db.insert(alertSubscriptions).values({ ...s, target: s.target ?? null }).onConflictDoUpdate({ target: [alertSubscriptions.projectId, alertSubscriptions.userId], set: { channel: s.channel, target: s.target ?? null } }); },
    remove: async (projectId, userId) => { await db.delete(alertSubscriptions).where(and(eq(alertSubscriptions.projectId, projectId), eq(alertSubscriptions.userId, userId))); },
  };
}
