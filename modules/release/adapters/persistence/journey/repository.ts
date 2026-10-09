import { ReleaseJourneyEventSchema } from '@crewstation/contracts';
import type { ServiceId } from '@crewstation/contracts';
import { conflict, jsonHash, newResourceId, notFound } from '@crewstation/kernel';
import type { Executor } from '@crewstation/persistence';
import { and, asc, desc, eq, gt, sql } from 'drizzle-orm';
import { sameJourneyTransition, transitionJourney } from '../../../domain/journey/journey';
import type { JourneyPatch, JourneyTransition, ReleaseJourney } from '../../../domain/journey/journey';
import { ReleaseJourneySchema } from '../../../domain/journey/schema';
import type { JourneyCursor, JourneyRepository } from '../../../ports/journey';
import { releaseJourneyEvents as events, releaseJourneys as journeys } from './tables';

const decode = (body: unknown): ReleaseJourney => ReleaseJourneySchema.parse(typeof body === 'string' ? JSON.parse(body) : body);
async function append(db: Executor, id: string, transition: JourneyTransition, patch: JourneyPatch = {}): Promise<ReleaseJourney> {
  const row = (await db.select().from(journeys).where(eq(journeys.id, id)).for('update'))[0];
  if (!row) throw notFound('发布流程', id);
  const current = decode(row.body);
  const prior = (await db.select().from(events).where(and(eq(events.journeyId, id), eq(events.transitionKey, transition.transitionKey))))[0];
  if (prior) {
    if (!sameJourneyTransition(ReleaseJourneyEventSchema.parse(prior.body), transition) || Object.entries(patch).some(([key, value]) => jsonHash(current[key as keyof ReleaseJourney]) !== jsonHash(value))) throw conflict('阶段来源键已用于不同事实', { code: 'idempotency_conflict' });
    return current;
  }
  const next = transitionJourney(current, transition, patch);
  const event = ReleaseJourneyEventSchema.parse({ ...transition, id: newResourceId(), journeyId: id, sequence: next.revision });
  await db.insert(events).values({ id: event.id, projectId: current.snapshot.projectId, serviceId: current.snapshot.serviceId, releaseId: current.snapshot.releaseId,
    journeyId: id, sequence: event.sequence, transitionKey: event.transitionKey, body: event, createdAt: new Date(event.at) });
  await db.update(journeys).set({ body: next, status: next.status, revision: next.revision, requestKey: next.launch?.requestKey ?? null }).where(eq(journeys.id, id));
  return next;
}

async function page(db: Executor, serviceId: ServiceId, limit: number, cursor?: JourneyCursor, tag?: string, filter?: 'active' | 'ended'): Promise<JourneyCursor[]> {
  const boundary = cursor ? sql`WHERE (created_at,id,record_kind) < (${cursor.at}::timestamptz,${cursor.id},${cursor.recordKind})` : sql``;
  const journalFilter = !filter ? sql`` : filter === 'active' ? sql`AND status IN ('running','awaiting-verification','awaiting-confirmation')` : sql`AND status IN ('succeeded','failed','interrupted')`;
  const legacyFilter = !filter ? sql`` : filter === 'active' ? sql`AND status IN ('pending','building','migrating','deploying')` : sql`AND status NOT IN ('pending','building','migrating','deploying')`;
  const rows = await db.execute<{ at: string; id: string; record_kind: 'journey' | 'legacy' }>(sql`
    WITH history AS (
      SELECT created_at,id,'journey'::text AS record_kind FROM release.release_journeys WHERE service_id=${serviceId} ${tag ? sql`AND body->'snapshot'->>'tag'=${tag}` : sql``} ${journalFilter}
      UNION ALL
      SELECT created_at,id,'legacy'::text FROM release.releases AS r WHERE service_id=${serviceId}
        ${tag ? sql`AND tag=${tag}` : sql``} ${legacyFilter}
        AND NOT EXISTS (SELECT 1 FROM release.release_journeys AS j WHERE j.release_id=r.id AND j.kind='publish')
    ) SELECT to_char(created_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS at,id,record_kind FROM history
      ${boundary} ORDER BY created_at DESC,id DESC,record_kind DESC LIMIT ${limit}`);
  return rows.map((row) => ({ at: row.at, id: row.id, recordKind: row.record_kind }));
}

export function drizzleJourneys(db: Executor): JourneyRepository {
  return {
    insert: async (journey) => {
      const body = ReleaseJourneySchema.parse(journey), snapshot = body.snapshot;
      await db.insert(journeys).values({ id: body.id, projectId: snapshot.projectId, serviceId: snapshot.serviceId, releaseId: snapshot.releaseId,
        kind: snapshot.kind, status: body.status, revision: body.revision, requestKey: body.launch?.requestKey ?? null, body, createdAt: new Date(snapshot.startedAt) });
    },
    get: async (id) => { const row = (await db.select().from(journeys).where(eq(journeys.id, id)))[0]; return row ? decode(row.body) : undefined; },
    snapshot: async (id) => {
      const row = (await db.execute<{ body: unknown; events: unknown[] }>(sql`SELECT j.body,
        COALESCE((SELECT jsonb_agg(e.body ORDER BY e.sequence) FROM release.release_journey_events e WHERE e.journey_id=j.id),'[]'::jsonb) AS events
        FROM release.release_journeys j WHERE j.id=${id}`))[0];
      return row ? { journey: decode(row.body), events: row.events.map((event) => ReleaseJourneyEventSchema.parse(event)) } : undefined;
    },
    events: async (id) => (await db.select().from(events).where(eq(events.journeyId, id)).orderBy(asc(events.sequence))).map((row) => ReleaseJourneyEventSchema.parse(row.body)),
    append: (id, transition, patch) => append(db, id, transition, patch),
    byRelease: async (id) => (await db.select().from(journeys).where(eq(journeys.releaseId, id)).orderBy(desc(journeys.createdAt), desc(journeys.id))).map((row) => decode(row.body)),
    bySwitchKey: async (serviceId, key) => { const row = (await db.select().from(journeys).where(and(eq(journeys.serviceId, serviceId), eq(journeys.requestKey, key))))[0]; return row ? decode(row.body) : undefined; },
    page: (serviceId, limit, cursor, tag, filter) => page(db, serviceId, limit, cursor, tag, filter),
    pendingLaunches: async (limit, afterId) => (await db.select().from(journeys).where(and(eq(journeys.status, 'running'), sql`${journeys.body}->'launch' IS NOT NULL`, afterId ? gt(journeys.id, afterId) : undefined)).orderBy(asc(journeys.id)).limit(limit)).map((row) => decode(row.body)),
  };
}
