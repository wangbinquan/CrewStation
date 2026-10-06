import { describe, expect, test } from 'bun:test';
import { BUILTIN_RESOURCES, DomainTopic } from '@crewstation/contracts';
import type { Actor } from '@crewstation/contracts';
import { eventbusMigrations } from '@crewstation/eventbus';
import { jsonHash } from '@crewstation/kernel';
import { createIdentityModule, identityMigrations } from '@crewstation/module-identity';
import { createProjectModule, projectMigrations } from '@crewstation/module-project';
import { resourceIdentityDirectory } from '@crewstation/persistence';
import { queueMigrations } from '@crewstation/queue';
import { createTestDatabase, testDatabaseAvailable } from '@crewstation/testkit';
import { sql } from 'drizzle-orm';
import { infrastructureContentSource } from '../adapters/persistence/infrastructureContents';
import { inspectInfrastructureContents } from '../application/infrastructureInventory';
import type { InfrastructureContentSource } from '../ports/infrastructureContents';
import type { InfrastructureOriginSources } from '../ports/infrastructureOrigins';

const available = await testDatabaseAvailable();
async function fixture() {
  const database = await createTestDatabase([eventbusMigrations, queueMigrations, identityMigrations, projectMigrations]);
  const identity = createIdentityModule({ db: database.db, settings: { adminEmails: ['infrastructure@tests.invalid'] } });
  const user = await identity.api.ensureUser({ externalId: 'infrastructure', name: 'Admin', email: 'infrastructure@tests.invalid' });
  const actor: Actor = { userId: user.id, isAdmin: true };
  const project = createProjectModule({ db: database.db, identity: identity.api,
    hosts: { prodHost: (s) => `${s}.test`, previewHost: (s) => `preview.${s}.test`, serviceHost: (s) => `${s}.svc.test` },
    settings: { defaultServicePlan: BUILTIN_RESOURCES.servicePlanSmall, defaultMaxConcurrentTasks: 3 } });
  const make = (slug: string) => project.api.createProject(actor, { slug, name: 'private infrastructure project', kind: 'DigitalWorker', template: BUILTIN_RESOURCES.minimalTemplate });
  const own = await make('infra-original'), other = await make('infra-retained');
  const origins: InfrastructureOriginSources = { resolve: (_document, ref, representation) => {
    if (ref.kind !== 'project') throw new Error('This fixture only has actual original Project source ports');
    return project.api.originalInfrastructureOwnership('project', ref.key, representation);
  } };
  const source = infrastructureContentSource(database.db);
  const seed = async () => {
    await database.db.execute(sql`INSERT INTO platform_infra.jobs(id,kind,payload,last_error)
      SELECT i,'project.provision',jsonb_build_object('projectId',${own.id}::text),'private queue error' FROM generate_series(101,305) i`);
    await database.db.execute(sql`INSERT INTO platform_infra.jobs(id,kind,payload,last_error)
      VALUES(9007199254740994,'project.provision',jsonb_build_object('projectId',${other.id}::text),'retained private error')`);
    await database.db.execute(sql`INSERT INTO platform_infra.domain_events(id,topic,payload,occurred_at)
      SELECT 1000+i,${DomainTopic.configChanged},jsonb_build_object('projectId',${own.id}::text,'env','production','version',i,'occurredAt','2026-10-03T00:00:00Z'),'2026-10-03'::timestamptz FROM generate_series(1,205) i`);
    await database.db.execute(sql`INSERT INTO platform_infra.domain_events(id,topic,payload,occurred_at)
      VALUES(9007199254740994,${DomainTopic.configChanged},jsonb_build_object('projectId',${other.id}::text,'env','production','version',1,'occurredAt','2026-10-03T00:00:00Z'),'2026-10-03'::timestamptz)`);
    await database.db.execute(sql`INSERT INTO platform_infra.event_dead_letters(consumer,event_id,error) VALUES('private-consumer-a',1001,'private event error'),('private-consumer-b',1001,'private event error')`);
  };
  const inspect = (input: InfrastructureContentSource = source, sourcePorts: InfrastructureOriginSources = origins) => inspectInfrastructureContents(own.id, input, sourcePorts);
  return { database, project, own, other, source, origins, seed, inspect };
}
describe.skipIf(!available)('infrastructure EOF inventory (actual PostgreSQL, package readers and public Project origins)', () => {
  test('reads every page, legacy aliases and dead letters; preserves unrelated content and returns only minimum origins', async () => {
    const f = await fixture();
    try {
      await f.seed();
      const directory = resourceIdentityDirectory(f.database.db, () => [projectMigrations]);
      await directory.bind('project', 'project', ['private-old-project'], f.own.id);
      for (const [table, id] of [['jobs', 301], ['domain_events', 1205]] as const) {
        const body = (await f.database.db.execute<{ payload: Record<string, unknown> }>(sql`SELECT payload FROM platform_infra.${sql.identifier(table)} WHERE id=${id}`))[0]!.payload;
        const legacy = { ...body, projectId: 'private-old-project' }, provenance = { version: 'resource-identity/v1', sourceColumn: 'legacy_payload', originalHash: jsonHash(legacy), normalizedHash: jsonHash(body) };
        await f.database.db.execute(sql`UPDATE platform_infra.${sql.identifier(table)} SET legacy_payload=${JSON.stringify(legacy)}::jsonb,identity_provenance=${JSON.stringify(provenance)}::jsonb WHERE id=${id}`);
      }
      const pages = { queue: [] as (string | null)[], event: [] as (string | null)[] };
      const counted: InfrastructureContentSource = { withSnapshot: (read) => f.source.withSnapshot((reader) => read({ ...reader,
        queue: (after) => { pages.queue.push(after); return reader.queue(after); }, event: (after) => { pages.event.push(after); return reader.event(after); },
      })) };
      const result = await f.inspect(counted);
      expect(result.inventory.complete).toBe(true); expect(result.traversal).toMatchObject({ queue: true, event: true, orphanErrors: true, scanned: { queue: 206, event: 208, orphanErrors: 0 } });
      expect(pages.queue).toHaveLength(3); expect(pages.event).toHaveLength(3);
      expect(pages.queue.at(-1)).toBe('9007199254740994'); expect(pages.event.at(-1)).toBe('9007199254740994');
      expect(result.contents.filter((entry) => entry.channel === 'queue')).toHaveLength(205);
      expect(result.contents.filter((entry) => entry.channel === 'event')).toHaveLength(206);
      expect(result.inventory.resources.find((entry) => entry.kind === 'event-errors')).toMatchObject({ id: 'event:1001', count: 2 });
      for (const privateText of ['private queue error', 'private event error', 'private-consumer', 'private-old-project', 'infra-original', 'payload']) expect(JSON.stringify(result)).not.toContain(privateText);
      await f.database.db.execute(sql`UPDATE platform_infra.jobs SET last_error='changed retained error' WHERE id=9007199254740994`);
      const again = await f.inspect();
      expect(again.inventory.revision).toBe(result.inventory.revision); expect(again.traversal.digest).not.toBe(result.traversal.digest);
      expect((await f.database.db.execute<{ total: number }>(sql`SELECT count(*)::integer AS total FROM platform_infra.jobs`))[0]?.total).toBe(206);
      expect((await f.database.db.execute<{ total: number }>(sql`SELECT count(*)::integer AS total FROM platform_infra.event_dead_letters`))[0]?.total).toBe(2);
    } finally { await f.database.drop(); }
  }, 20_000);
  test('one actual repeatable-read snapshot excludes writes committed between pages; the next inventory detects the new target content', async () => {
    const f = await fixture(), reached = Promise.withResolvers<void>(), resume = Promise.withResolvers<void>();
    let pending: ReturnType<typeof f.inspect> | undefined;
    try {
      await f.seed(); let first = true;
      pending = f.inspect(f.source, { resolve: async (document, ref, representation) => {
        const value = await f.origins.resolve(document, ref, representation);
        if (first) { first = false; reached.resolve(); await resume.promise; }
        return value;
      } });
      await reached.promise;
      await f.database.db.execute(sql`INSERT INTO platform_infra.jobs(id,kind,payload)
        VALUES(9007199254740995,'project.provision',jsonb_build_object('projectId',${f.own.id}::text))`);
      await f.database.db.execute(sql`INSERT INTO platform_infra.domain_events(id,topic,payload,occurred_at)
        VALUES(9007199254740995,${DomainTopic.configChanged},jsonb_build_object('projectId',${f.own.id}::text,'env','production','version',2,'occurredAt','2026-10-03T00:00:00Z'),'2026-10-03'::timestamptz)`);
      resume.resolve(); const old = await pending;
      expect(old.inventory.complete).toBe(true); expect(old.contents).toHaveLength(411);
      expect(old.contents.some((entry) => entry.id === '9007199254740995')).toBe(false);
      const fresh = await f.inspect(); expect(fresh.inventory.complete).toBe(true); expect(fresh.contents).toHaveLength(413);
      expect(fresh.inventory.revision).not.toBe(old.inventory.revision);
      expect(fresh.contents.filter((entry) => entry.id === '9007199254740995')).toHaveLength(2);
    } finally { resume.resolve(); await Promise.allSettled([pending]); await f.database.drop(); }
  }, 20_000);
  test('unknown columns and late-page unclassified jobs promptly block; unvisited orphan-error pages remain incomplete and intact', async () => {
    const f = await fixture();
    try {
      await f.seed();
      await f.database.db.execute(sql`INSERT INTO platform_infra.jobs(id,kind,payload) VALUES(9007199254740995,'future-job','{}'::jsonb)`);
      await f.database.db.execute(sql`INSERT INTO platform_infra.event_dead_letters(consumer,event_id,error)
        SELECT 'private-orphan-'||lpad(i::text,4,'0'),9007199254740996,'private orphan error' FROM generate_series(1,203) i`);
      const result = await f.inspect(); expect(result.inventory.complete).toBe(false);
      expect(result.traversal).toMatchObject({ queue: false, event: true, orphanErrors: false, scanned: { queue: 207, event: 208, orphanErrors: 200 } });
      expect(result.inventory.blockers.filter((entry) => entry.code === 'infrastructure-orphan-error')).toHaveLength(200);
      expect(result.inventory.blockers.find((entry) => entry.code === 'infrastructure-origin-unavailable')?.resourceId).toBe('queue:9007199254740995');
      expect(JSON.stringify(result)).not.toContain('private-orphan'); expect(JSON.stringify(result)).not.toContain('private orphan error');
      await f.database.db.execute(sql`ALTER TABLE platform_infra.jobs ADD COLUMN future_private_content text`);
      const unknown = await f.inspect(); expect(unknown.inventory.complete).toBe(false); expect(unknown.traversal.queue).toBe(false);
      expect(unknown.traversal.event).toBe(true); expect(unknown.inventory.blockers.some((entry) => entry.resourceId === 'queue' && entry.code === 'infrastructure-traversal-incomplete')).toBe(true);
      expect((await f.database.db.execute<{ total: number }>(sql`SELECT count(*)::integer AS total FROM platform_infra.jobs`))[0]?.total).toBe(207);
      expect((await f.database.db.execute<{ total: number }>(sql`SELECT count(*)::integer AS total FROM platform_infra.event_dead_letters`))[0]?.total).toBe(205);
    } finally { await f.database.drop(); }
  }, 20_000);
});
