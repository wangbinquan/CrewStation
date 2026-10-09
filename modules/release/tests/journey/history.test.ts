import { afterEach, describe, expect, test } from 'bun:test';
import type { Actor, ReleaseId } from '@crewstation/contracts';
import { forbidden, newResourceId } from '@crewstation/kernel';
import { testDatabaseAvailable } from '@crewstation/testkit';
import { runMigrations } from '@crewstation/persistence';
import { sql } from 'drizzle-orm';
import { createJourney } from '../../application/journey/recording';
import { releaseMigrations } from '../../wiring';
import { releaseImageFixture } from '../runtimeImageFixture';
import { executionHandoffFixture } from '../executionHandoffFixture';
import { journeyQueries } from '../../application/journey/queries';

const available = await testDatabaseAvailable();
describe.skipIf(!available)('RFC-038 complete read-only history', () => {
  let close: (() => Promise<void>) | undefined;
  afterEach(async () => { await close?.(); close = undefined; });
  test('mixed history uses stable keyset pagination and complete per-release switch/event queries', async () => {
    const f = await executionHandoffFixture(); close = f.close;
    const queries = journeyQueries({ ...f.deps, hosts: { prodHost: () => 'prod', previewHost: () => 'preview' } });
    for (let i = 0; i < 53; i++) {
      const release = { ...f.target, id: newResourceId() as ReleaseId, tag: `v1.0.${i}` };
      await f.uow.read.releases.insert(release);
      if (i % 2 === 0) await f.uow.run(scope => createJourney(scope, release, f.actor.userId, 'publish', { kind: 'repository' }, f.deps.clock.now()));
      await f.uow.read.switches.insert({ id: newResourceId(), serviceId: f.serviceId, fromSlot: 'preview', toSlot: 'prod', releaseId: f.target.id, actorUserId: f.actor.userId, createdAt: new Date() });
    }
    const first = await queries.listJourneys(f.actor, f.serviceId, { limit: 20 });
    expect(first.hasMore).toBe(true); expect(first.items).toHaveLength(20);
    const all = [...first.items]; let cursor = first.nextCursor;
    while (cursor) { const page = await queries.listJourneys(f.actor, f.serviceId, { limit: 20, cursor }); all.push(...page.items); cursor = page.nextCursor; }
    expect(all).toHaveLength(55);
    expect(new Set(all.map(item => item.recordKind === 'journey' ? item.id : item.release.id)).size).toBe(55);
    const active = await queries.listJourneys(f.actor, f.serviceId, { limit: 50, filter: 'active' });
    expect(active.items).toHaveLength(27); expect(active.items.every(item => item.recordKind === 'journey')).toBe(true);
    const ended = await queries.listJourneys(f.actor, f.serviceId, { limit: 50, filter: 'ended' });
    expect(ended.items).toHaveLength(28); expect(ended.items.every(item => item.recordKind === 'legacy')).toBe(true);
    await expect(queries.listJourneys(f.actor, f.serviceId, { limit: 20, cursor: first.nextCursor, filter: 'active' })).rejects.toMatchObject({ kind: 'validation' });
    const history = await queries.journeyHistory(f.actor, f.target.id);
    expect(history.trafficSwitches).toHaveLength(53);
    expect(history.legacy?.stages.every(stage => stage.state === 'unknown')).toBe(true);
    await expect(queries.listJourneys(f.actor, f.serviceId, { limit: 20, cursor: 'not-a-cursor' })).rejects.toMatchObject({ kind: 'validation' });
  });
  test('history and verification retain original project authorization, GET does not create a journal for legacy', async () => {
    const f = await executionHandoffFixture(); close = f.close;
    const authorizer = { authorize: async (actor: Actor) => { if (actor.userId !== f.actor.userId) throw forbidden('another project'); } };
    const queries = journeyQueries({ ...f.deps, authorizer, hosts: { prodHost: () => 'prod', previewHost: () => 'preview' } });
    const journey = await f.uow.run(scope => createJourney(scope, f.target, f.actor.userId, 'redeploy', { kind: 'external' }, f.deps.clock.now()));
    await expect(queries.getJourney({ ...f.actor, userId: newResourceId() as Actor['userId'] }, journey.id)).rejects.toMatchObject({ kind: 'forbidden' });
    const before = await f.database.db.execute(sql`SELECT count(*)::int AS count FROM release.release_journeys`);
    expect((await queries.journeyHistory(f.actor, f.old.id)).legacy?.release.id).toBe(f.old.id);
    expect(await f.database.db.execute(sql`SELECT count(*)::int AS count FROM release.release_journeys`)).toEqual(before);
  });
  test('0011 can upgrade an original 0010 database without backfilling invented stages', async () => {
    const { createTestDatabase } = await import('@crewstation/testkit');
    const { eventbusMigrations } = await import('@crewstation/eventbus');
    const database = await createTestDatabase([eventbusMigrations, { ...releaseMigrations, files: releaseMigrations.files.filter(file => file.name < '0011') }]); close = () => database.drop();
    expect((await database.db.execute(sql`SELECT tablename FROM pg_tables WHERE schemaname='release' AND tablename='release_journeys'`))).toHaveLength(0);
    await runMigrations(database.db, [releaseMigrations]);
    expect((await database.db.execute(sql`SELECT count(*)::int AS count FROM release.release_journeys`))[0]?.count).toBe(0);
    expect((await database.db.execute(sql`SELECT count(*)::int AS count FROM release.release_journey_events`))[0]?.count).toBe(0);
  });
  test('append failure rolls back the original accepted release and exposes no partial history', async () => {
    const f = await releaseImageFixture(); close = f.close;
    await f.db.execute(sql`CREATE FUNCTION public.reject_journey_event() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'controlled journal failure'; END $$`);
    await f.db.execute(sql`CREATE TRIGGER controlled_journal_failure BEFORE INSERT ON release.release_journey_events FOR EACH ROW EXECUTE FUNCTION public.reject_journey_event()`);
    await expect(f.runtime.api.publish(f.actor, f.serviceId, { branch: 'main', version: 'v9.0.0' })).rejects.toThrow();
    expect((await f.db.execute(sql`SELECT count(*)::int AS count FROM release.releases`))[0]?.count).toBe(0);
    expect((await f.db.execute(sql`SELECT count(*)::int AS count FROM release.release_journeys`))[0]?.count).toBe(0);
  });
});
