import { describe, expect, test } from 'bun:test';
import { DomainTopic, PROJECT_DELETION_PHASES } from '@crewstation/contracts';
import type { ProjectDeletionContext } from '@crewstation/contracts';
import { readEventContents } from '@crewstation/eventbus';
import { jsonHash } from '@crewstation/kernel';
import { readQueueContents } from '@crewstation/queue';
import { testDatabaseAvailable } from '@crewstation/testkit';
import { sql } from 'drizzle-orm';
import { infrastructureContentRemoval } from '../../adapters/persistence/infrastructureRemoval';
import type { InfrastructureCoordinator } from '../../domain/infrastructureCoordinator';
import type { OwnedInfrastructureContent } from '../../domain/infrastructureContents';
import { projectWorkFixture } from '../projectWorkFixture';

const available = await testDatabaseAvailable();
async function fixture() {
  const f = await projectWorkFixture(), own = f.create(), other = f.create();
  let coordinator: InfrastructureCoordinator | undefined;
  const owner = f.module.api.projectDeletionOwner({ coordinator: async (id) => coordinator?.projectId === id ? coordinator : undefined,
    origins: { resolve: async (_document, reference) => {
      const facts = f.facts.get(reference.key as typeof own.projectId);
      return facts ? { complete: true, id: facts.projectId, scope: 'project', projectIds: [facts.projectId], revision: jsonHash({ id: facts.projectId }) } : undefined;
    } } });
  const context = async (): Promise<ProjectDeletionContext> => ({ ...f.context(own), confirmed: await owner.inspect(f.context(own).target) });
  const seed = async () => {
    await f.work.run(own.projectId, own.serviceId, 'provision', jsonHash('original own'), async () => undefined);
    await f.work.run(other.projectId, other.serviceId, 'provision', jsonHash('original other'), async () => undefined);
    await f.database.db.execute(sql`INSERT INTO platform_infra.jobs(kind,payload,last_error)
      SELECT 'project.provision',jsonb_build_object('projectId',${own.projectId}::text),'private queue error' FROM generate_series(1,205)`);
    await f.database.db.execute(sql`INSERT INTO platform_infra.jobs(kind,payload,last_error) VALUES('project.provision',jsonb_build_object('projectId',${other.projectId}::text),'retained queue error')`);
    await f.database.db.execute(sql`INSERT INTO platform_infra.domain_events(topic,payload,trace_id,occurred_at)
      SELECT ${DomainTopic.configChanged},jsonb_build_object('projectId',${own.projectId}::text,'env','production','version',i,'occurredAt','2026-10-03T00:00:00Z'),'private trace',now() FROM generate_series(1,205) i`);
    await f.database.db.execute(sql`INSERT INTO platform_infra.domain_events(topic,payload,occurred_at) VALUES(${DomainTopic.projectArchived},
      jsonb_build_object('projectId',${other.projectId}::text,'occurredAt','2026-10-03T00:00:00Z'),now())`);
    const first = (await readEventContents(f.database.db))[0]!;
    await f.database.db.execute(sql`INSERT INTO platform_infra.event_dead_letters(consumer,event_id,error) VALUES('private consumer',${first.id}::bigint,'private event failure')`);
  };
  return { ...f, own, other, owner, context, seed, coordinator: (value: InfrastructureCoordinator) => { coordinator = value; } };
}
describe.skipIf(!available)('provisioning deletion owner (actual PG and original callbacks; controlled container and ownership sources)', () => {
  test('all seven durable stages clear every content page and original callback, compact minimum scope and preserve other projects and the active coordinator', async () => {
    const f = await fixture();
    try {
      await f.seed(); const context = await f.context(); expect(context.confirmed.complete).toBe(true);
      const retainedCallback = await f.work.history(f.other.projectId);
      const retainedQueue = (await readQueueContents(f.database.db, '205'))[0]!;
      const retainedEvent = (await readEventContents(f.database.db, '205'))[0]!;
      f.coordinator({ projectId: f.own.projectId, operationId: context.operationId });
      await f.database.db.execute(sql`INSERT INTO platform_infra.jobs(kind,payload) VALUES('provisioning.project-deletion',jsonb_build_object('operationId',${context.operationId}::text))`);
      await f.database.db.execute(sql`INSERT INTO platform_infra.domain_events(topic,payload,occurred_at) VALUES(${DomainTopic.projectDeletionRequested},
        jsonb_build_object('projectId',${f.own.projectId}::text,'operationId',${context.operationId}::text,'occurredAt','2026-10-03T00:00:00Z'),now())`);
      expect((await f.owner.inspect(context.target)).revision).toBe(context.confirmed.revision);
      f.facts.set(f.own.projectId, { ...f.own, state: 'deleting' });
      for (const phase of PROJECT_DELETION_PHASES) {
        const result = await f.owner.run({ ...context, phase }); expect(result.kind).toBe('done');
        if (result.kind !== 'done') throw new Error('actual provisioning phase did not complete');
        expect(result.evidence.kind).toBe(phase === 'namespace' ? 'not-applicable' : 'metadata');
      }
      expect(await f.work.history(f.own.projectId)).toEqual([]); expect(await f.work.history(f.other.projectId)).toEqual(retainedCallback);
      expect((await readQueueContents(f.database.db)).find((row) => row.id === retainedQueue.id)).toEqual(retainedQueue);
      expect((await readEventContents(f.database.db)).find((row) => row.id === retainedEvent.id)).toEqual(retainedEvent);
      expect((await readQueueContents(f.database.db)).map((row) => row.kind)).toEqual(['project.provision', 'provisioning.project-deletion']);
      expect((await readEventContents(f.database.db)).map((row) => row.topic)).toEqual([DomainTopic.projectArchived, DomainTopic.projectDeletionRequested]);
      expect(await f.database.db.execute('SELECT event_id FROM platform_infra.event_dead_letters')).toHaveLength(0);
      const stored = (await f.database.db.execute<{ body: unknown; phases: object }>(sql`SELECT body,phases FROM provisioning.deletion_scopes WHERE project_id=${f.own.projectId}`))[0]!;
      expect(stored.body).toMatchObject({ callbacks: [], contents: [], compacted: true, count: 412 });
      expect(Object.keys(stored.phases)).toHaveLength(7);
      for (const secret of ['private queue', 'private trace', 'private event', 'private consumer', 'exitKey', 'backendPid']) expect(JSON.stringify(stored)).not.toContain(secret);
      expect((await f.owner.inspect(context.target)).resources).toEqual([]);
      expect(await f.owner.run({ ...context, phase: 'verify', generation: 2 })).toEqual(await f.owner.run({ ...context, phase: 'verify' }));
      f.facts.set(f.own.projectId, { ...f.own, state: 'active' });
      await expect(f.work.run(f.own.projectId, f.own.serviceId, 'enqueue', jsonHash('late'), async () => { throw new Error('late work must not run'); })).rejects.toThrow();
      await expect(f.database.db.execute(sql`DELETE FROM provisioning.deletion_scopes WHERE project_id=${f.own.projectId}`).then(() => undefined)).rejects.toThrow();
      await expect(f.database.db.execute('TRUNCATE provisioning.deletion_scopes').then(() => undefined)).rejects.toThrow();
    } finally { await f.drop(); }
  }, 30_000);
  test('scope changes close admission but require a new confirmation; original grant, monotone generation and durable phase order protect callback deletion', async () => {
    const f = await fixture();
    try {
      await f.work.run(f.own.projectId, f.own.serviceId, 'provision', jsonHash('original'), async () => undefined);
      const original = await f.context();
      await f.database.db.execute(sql`INSERT INTO platform_infra.jobs(kind,payload) VALUES('project.provision',jsonb_build_object('projectId',${f.own.projectId}::text))`);
      expect(await f.owner.run(original)).toMatchObject({ kind: 'blocked', blockers: [{ code: 'inventory-changed' }] });
      expect(await f.database.db.execute(sql`SELECT project_id FROM provisioning.project_admissions WHERE project_id=${f.own.projectId}`)).toHaveLength(1);
      const renewed = { ...await f.context(), operationId: original.operationId, generation: 2 };
      expect((await f.owner.run(renewed)).kind).toBe('done');
      await expect(f.owner.run({ ...renewed, phase: 'purge' })).rejects.toThrow();
      await expect(f.database.db.execute(sql`DELETE FROM provisioning.original_callbacks WHERE project_id=${f.own.projectId}`).then(() => undefined)).rejects.toThrow();
      await expect(f.database.db.execute(sql`UPDATE provisioning.deletion_scopes SET body=jsonb_set(body,'{compacted}','true') WHERE project_id=${f.own.projectId}`).then(() => undefined)).rejects.toThrow();
      f.permit(false); await expect(f.owner.run({ ...renewed, phase: 'stop' })).rejects.toThrow(); f.permit(true);
      await expect(f.owner.run({ ...renewed, generation: 1, phase: 'stop' })).rejects.toThrow();
      expect((await f.owner.run({ ...renewed, phase: 'stop' })).kind).toBe('done');
      expect((await f.owner.run({ ...renewed, phase: 'stop', generation: 3 })).kind).toBe('done');
      expect(await f.work.history(f.own.projectId)).toHaveLength(1);
    } finally { await f.drop(); }
  });
  test('an actual lost backend is not an exit proof; stop waits until the original private callback finally records its exit', async () => {
    const f = await fixture(), entered = Promise.withResolvers<void>(), release = Promise.withResolvers<void>();
    let running: Promise<void> | undefined;
    try {
      running = f.work.run(f.own.projectId, f.own.serviceId, 'provision', jsonHash('actual suspended original'), async () => { entered.resolve(); await release.promise; });
      const rejected = running.catch(() => undefined); await entered.promise;
      const callback = (await f.work.history(f.own.projectId))[0]!, context = await f.context();
      expect((await f.database.db.execute<{ stopped: boolean }>(sql`SELECT pg_terminate_backend(${callback.backendPid}) AS stopped`))[0]?.stopped).toBe(true);
      await rejected;
      expect((await f.owner.run(context)).kind).toBe('done');
      expect(await f.owner.run({ ...context, phase: 'stop' })).toMatchObject({ kind: 'waiting' });
      expect((await f.work.history(f.own.projectId))[0]?.exited).toBe(false);
      release.resolve(); await f.waitExit(callback.id);
      expect((await f.owner.run({ ...context, phase: 'stop' })).kind).toBe('done');
      expect((await f.work.history(f.own.projectId))[0]?.exited).toBe(true);
    } finally { release.resolve(); await running?.catch(() => undefined); await f.drop(); }
  }, 30_000);
  test('unknown columns, unresolved or shared ownership, and orphan errors block inspection and retain all original content', async () => {
    const f = await fixture();
    try {
      const target = (await f.context()).target;
      await f.database.db.execute(sql`INSERT INTO platform_infra.jobs(kind,payload) VALUES('project.provision',jsonb_build_object('projectId',${f.own.projectId}::text))`);
      const shared = f.module.api.projectDeletionOwner({ coordinator: async () => undefined, origins: { resolve: async (_document, reference) =>
        ({ complete: true, id: reference.key, scope: 'project', projectIds: [f.own.projectId, f.other.projectId], revision: jsonHash('controlled shared ownership') }) } });
      expect((await shared.inspect(target)).complete).toBe(false);
      const missing = f.module.api.projectDeletionOwner({ coordinator: async () => undefined, origins: { resolve: async () => undefined } });
      expect((await missing.inspect(target)).complete).toBe(false);
      await f.database.db.execute(sql`INSERT INTO platform_infra.event_dead_letters(consumer,event_id,error) VALUES('orphan',9999,'private historical error')`);
      expect((await f.owner.inspect(target)).complete).toBe(false);
      await f.database.db.execute('ALTER TABLE provisioning.original_callbacks ADD COLUMN unexpected_secret text');
      await expect(f.owner.inspect(target)).rejects.toThrow();
      expect(await f.database.db.execute('SELECT id FROM platform_infra.jobs')).toHaveLength(1);
    } finally { await f.drop(); }
  });
  test('changed event errors roll back earlier queue removal; fresh exact origins remove both channels together', async () => {
    const f = await fixture();
    try {
      await f.database.db.execute(sql`INSERT INTO platform_infra.jobs(kind,payload) VALUES('project.provision',jsonb_build_object('projectId',${f.own.projectId}::text))`);
      await f.database.db.execute(sql`INSERT INTO platform_infra.domain_events(topic,payload,occurred_at) VALUES(${DomainTopic.projectArchived},jsonb_build_object('projectId',${f.own.projectId}::text,'occurredAt','2026-10-03T00:00:00Z'),now())`);
      const queue = (await readQueueContents(f.database.db))[0]!, event = (await readEventContents(f.database.db))[0]!;
      const content = (channel: 'queue' | 'event', row: typeof queue | typeof event): OwnedInfrastructureContent => ({ ...row, channel,
        projectIds: [f.own.projectId], ownershipDigest: jsonHash('controlled original'), deadLetters: 'deadLetters' in row ? row.deadLetters : 0 });
      const removal = infrastructureContentRemoval(f.database.db);
      await f.database.db.execute(sql`INSERT INTO platform_infra.event_dead_letters(consumer,event_id,error) VALUES('a',${event.id}::bigint,'changed private error')`);
      expect(await removal.remove([content('queue', queue), content('event', event)])).toBe(false);
      expect(await readQueueContents(f.database.db)).toHaveLength(1); expect(await readEventContents(f.database.db)).toHaveLength(1);
      expect(await removal.remove([content('queue', queue), content('event', (await readEventContents(f.database.db))[0]!)])).toBe(true);
      expect(await readQueueContents(f.database.db)).toEqual([]); expect(await readEventContents(f.database.db)).toEqual([]);
      expect(await removal.remove([])).toBe(true);
    } finally { await f.drop(); }
  });
});
