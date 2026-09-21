import { and, desc, eq, lt, lte, sql } from 'drizzle-orm';
import { newResourceId } from '@crewstation/kernel';
import type { Database, Transaction } from '@crewstation/persistence';
import { enqueueJob } from '@crewstation/queue';
import type { ClusterHistoryResource } from '@crewstation/contracts';
import type { CollectorKind, CollectorTicket, MetricsRepository } from '../../ports/metrics';
import type { MetricsObservation } from '../../domain/observations';
import { metricCollectors, metricHistory, metricObservations, metricStorage } from './metricsTables';

import { METRICS_JOB, STORAGE_JOB } from '../../ports/metrics';
const ticketWhere = (kind: CollectorKind, ticket: CollectorTicket) => and(eq(metricCollectors.kind, kind), eq(metricCollectors.requestId, ticket.requestId), eq(metricCollectors.fence, ticket.fence));
async function owns(tx: Transaction, kind: CollectorKind, ticket: CollectorTicket) { return (await tx.select().from(metricCollectors).where(ticketWhere(kind, ticket)).for('update')).length === 1; }
async function updateIdentities(tx: Transaction, observation: MetricsObservation) {
  const old = await tx.select().from(metricHistory), seen = new Set(observation.identities.map((i) => i.resourceId));
  const previous = new Map(old.map((r) => [r.id, r.body]));
  const values = observation.identities.map((i) => {
    const before = previous.get(i.resourceId), versions = before ? [...before.versions] : i.versions;
    if (before && (before.name !== i.name || before.namespace !== i.namespace || before.scope !== i.scope || before.projectId !== i.projectId || before.deleted)) {
      const last = versions.at(-1); if (last && !last.to) versions[versions.length - 1] = { ...last, to: observation.at };
      versions.push({ from: observation.at, name: i.name, namespace: i.namespace, scope: i.scope, ...(i.projectId ? { projectId: i.projectId } : {}) });
    }
    const body: ClusterHistoryResource = { ...i, firstSeen: before?.firstSeen ?? i.firstSeen, versions: versions.filter((v) => !v.to || Date.parse(v.to) > Date.parse(observation.at) - 8 * 86_400_000) };
    return { id: i.resourceId, lastSeen: new Date(i.lastSeen), body };
  });
  for (let offset = 0; offset < values.length; offset += 500) await tx.insert(metricHistory).values(values.slice(offset, offset + 500)).onConflictDoUpdate({ target: metricHistory.id, set: { lastSeen: sql`excluded.last_seen`, body: sql`excluded.body` } });
  if (observation.identitiesComplete) for (const row of old.filter((r) => !seen.has(r.id) && !r.body.deleted)) {
    const versions = row.body.versions.map((v) => v.to ? v : { ...v, to: observation.at });
    await tx.update(metricHistory).set({ body: { ...row.body, deleted: true, versions } }).where(eq(metricHistory.id, row.id));
  }
  await tx.delete(metricHistory).where(lt(metricHistory.lastSeen, new Date(Date.parse(observation.at) - 8 * 86_400_000)));
}
export function drizzleMetricsRepository(db: Database): MetricsRepository {
  return {
    schedule: async (kind) => { await db.transaction(async (tx) => {
      await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${`cluster-management.${kind}`}))`);
      const old = (await tx.select().from(metricCollectors).where(eq(metricCollectors.kind, kind)).for('update'))[0], now = new Date();
      if (old && now.getTime() - old.requestedAt.getTime() < (old.state === 'pending' ? 120_000 : kind === 'metrics' ? 15_000 : 60_000)) return;
      const value = { kind, requestId: newResourceId(), fence: 0, state: 'pending', requestedAt: now };
      await tx.insert(metricCollectors).values(value).onConflictDoUpdate({ target: metricCollectors.kind, set: value });
      await enqueueJob(tx, kind === 'metrics' ? METRICS_JOB : STORAGE_JOB, { requestId: value.requestId }, { dedupKey: value.requestId, maxAttempts: 5 });
    }); },
    claim: async (kind, ticket) => (await db.update(metricCollectors).set({ fence: ticket.fence }).where(and(eq(metricCollectors.kind, kind), eq(metricCollectors.requestId, ticket.requestId), lte(metricCollectors.fence, ticket.fence))).returning()).length === 1,
    latest: async () => (await db.select().from(metricObservations).orderBy(desc(metricObservations.createdAt)).limit(1))[0]?.body,
    observation: async (id) => (await db.select().from(metricObservations).where(eq(metricObservations.id, id)))[0]?.body,
    save: async (value, ticket) => db.transaction(async (tx) => {
      if (!await owns(tx, 'metrics', ticket)) return false;
      const last = (await tx.select().from(metricObservations).orderBy(desc(metricObservations.createdAt)).limit(1))[0];
      if (last && last.createdAt.getTime() >= Date.parse(value.at)) return false;
      await tx.insert(metricObservations).values({ id: value.id, createdAt: new Date(value.at), body: value });
      await tx.delete(metricObservations).where(lt(metricObservations.createdAt, new Date(Date.parse(value.at) - 600_000)));
      await updateIdentities(tx, value); return true;
    }),
    storage: async () => (await db.select().from(metricStorage).where(eq(metricStorage.id, 'current')))[0]?.body ?? [],
    saveStorage: async (body, at, ticket) => db.transaction(async (tx) => {
      if (!await owns(tx, 'storage', ticket)) return false;
      const old = (await tx.select().from(metricStorage).where(eq(metricStorage.id, 'current')))[0];
      if (old && old.updatedAt.getTime() >= Date.parse(at)) return false;
      await tx.insert(metricStorage).values({ id: 'current', updatedAt: new Date(at), body }).onConflictDoUpdate({ target: metricStorage.id, set: { updatedAt: new Date(at), body } }); return true;
    }),
    finish: async (kind, ticket) => { await db.update(metricCollectors).set({ state: 'done' }).where(ticketWhere(kind, ticket)); },
    identities: async () => (await db.select().from(metricHistory).orderBy(desc(metricHistory.lastSeen))).map((r) => r.body),
  };
}
