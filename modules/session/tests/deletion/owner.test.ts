import { describe, expect, test } from 'bun:test';
import { PROJECT_DELETION_PHASES, TaskIdSchema } from '@crewstation/contracts';
import { jsonHash, newResourceId } from '@crewstation/kernel';
import { testDatabaseAvailable } from '@crewstation/testkit';
import { sql } from 'drizzle-orm';
import { SESSION_CONTENT } from '../../adapters/persistence/deletion/identity';
import { sessionConnectionHistory } from '../../adapters/persistence/deletion/lifetime';
import { sessionDeletionRepository } from '../../adapters/persistence/deletion/repository';
import { sessionDeletionOwner } from '../../application/projectDeletion';
import { openRunner, sessionDeletionFixture } from './fixture';

const available = await testDatabaseAvailable();
describe.skipIf(!available)('session deletion owner (actual PG and two WebSocket replicas; controlled ownership source)', () => {
  test('all stages close the original remote transport and pending command, clear ten content tables and preserve other project/platform sessions', async () => {
    const f = await sessionDeletionFixture();
    try {
      const own = f.task(), other = f.task(f.otherProject), platform = f.task(null);
      await f.seed(own, 205); await f.seed(other); await f.seed(platform);
      const runner = await openRunner(f.second.address, own), otherRunner = await openRunner(f.second.address, other), platformRunner = await openRunner(f.first.address, platform);
      const pending = f.second.module.api.sendCommand(own, { id: 'original-command', type: 'previewStatus' }).then(() => 'unexpected-success', (error) => error.details?.code ?? error.kind);
      await runner.next((frame) => frame.id === 'original-command');
      const context = await f.context(), owner = f.first.module.api.deletionOwner!;
      expect(context.confirmed.complete).toBe(true);
      const retained = await f.database.db.execute(sql`SELECT session.digest(to_jsonb(e)) AS hash FROM session.runner_events e WHERE task_id IN(${other},${platform}) ORDER BY task_id`);
      f.deleting();
      for (const phase of PROJECT_DELETION_PHASES) expect((await owner.run({ ...context, phase })).kind).toBe('done');
      await runner.closed; expect(await pending).toBe('runner_disconnected');
      expect(otherRunner.ws.readyState).toBe(WebSocket.OPEN); expect(platformRunner.ws.readyState).toBe(WebSocket.OPEN);
      expect(await f.second.module.api.connectionStatus(own)).toEqual({ connected: false });
      for (const table of SESSION_CONTENT) expect(await f.database.db.execute(sql`SELECT task_id FROM ${sql.raw('session.' + table)} WHERE task_id=${own}`)).toHaveLength(0);
      expect(await f.database.db.execute(sql`SELECT session.digest(to_jsonb(e)) AS hash FROM session.runner_events e WHERE task_id IN(${other},${platform}) ORDER BY task_id`)).toEqual(retained);
      const stored = (await f.database.db.execute<{ body: unknown; phases: object }>(sql`SELECT body,phases FROM session.project_deletions WHERE project_id=${f.projectId}`))[0]!;
      expect(stored.body).toMatchObject({ taskKeys: [], births: [], compacted: true, count: 215 }); expect(Object.keys(stored.phases)).toHaveLength(7);
      expect(JSON.stringify(stored)).not.toContain('private'); expect(JSON.stringify(stored)).not.toContain(own);
      expect((await owner.inspect(f.target)).resources).toEqual([]);
      expect(await owner.run({ ...context, phase: 'verify', generation: 2 })).toEqual(await owner.run({ ...context, phase: 'verify' }));
      await expect(f.database.db.execute(sql`INSERT INTO session.runner_events(task_id,seq,at,kind,event) VALUES(${own},999,now(),'agent','{}')`).then(() => undefined)).rejects.toMatchObject({ cause: { message: expect.stringContaining('closed') } });
      await expect(f.database.db.execute('DELETE FROM session.project_deletions').then(() => undefined)).rejects.toMatchObject({ cause: { message: expect.stringContaining('tombstone') } });
    } finally { await f.drop(); }
  }, 30_000);

  test('complete keyset traversal seals tasks without existing session rows, includes the final page and requires reconfirmation after content changes', async () => {
    const f = await sessionDeletionFixture();
    try {
      const tasks = Array.from({ length: 205 }, () => f.task()).sort();
      await f.seed(tasks.at(-1)!);
      const owner = f.first.module.api.deletionOwner!, context = await f.context();
      await f.database.db.execute(sql`UPDATE session.runner_events SET legacy_event='{"private":"changed legacy"}' WHERE task_id=${tasks.at(-1)!}`);
      expect(await owner.run(context)).toMatchObject({ kind: 'blocked', blockers: [{ code: 'inventory-changed' }] });
      expect(await f.database.db.execute('SELECT task_key FROM session.task_origins')).toHaveLength(205);
      await expect(f.database.db.execute(sql`INSERT INTO session.runner_events(task_id,seq,at,kind,event) VALUES(${tasks[0]},1,now(),'agent','{}')`).then(() => undefined)).rejects.toMatchObject({ cause: { message: expect.stringContaining('closed') } });
      const renewed = { ...await f.context(), generation: 2 };
      expect((await owner.run(renewed)).kind).toBe('done');
      await expect(owner.run({ ...renewed, phase: 'purge' })).rejects.toThrow('前一阶段');
      await expect(owner.run({ ...renewed, phase: 'stop', generation: 1 })).rejects.toThrow('世代');
      await expect(f.database.db.execute('DELETE FROM session.development_usage_streams').then(() => undefined)).rejects.toMatchObject({ cause: { message: expect.stringContaining('closed') } });
      f.permit(false); await expect(owner.run({ ...renewed, phase: 'stop' })).rejects.toThrow('grant'); f.permit(true);
      for (const phase of PROJECT_DELETION_PHASES.slice(1)) expect((await owner.run({ ...renewed, phase })).kind).toBe('done');
      expect((await owner.inspect(f.target)).resources).toEqual([]);
    } finally { await f.drop(); }
  }, 30_000);

  test('actual remote transport and durable exit are checked even when a browser fixture replaces global fetch', async () => {
    const request = globalThis.fetch;
    let f: Awaited<ReturnType<typeof sessionDeletionFixture>> | undefined;
    try {
      globalThis.fetch = Object.assign(async () => Response.json({ browserFixture: true }), { preconnect: request.preconnect });
      f = await sessionDeletionFixture();
      const task = f.task(), runner = await openRunner(f.second.address, task), context = await f.context(), owner = f.first.module.api.deletionOwner!;
      expect((await owner.run(context)).kind).toBe('done');
      expect((await owner.run({ ...context, phase: 'stop' })).kind).toBe('done');
      await runner.closed;
      expect(await f.database.db.execute('SELECT id FROM session.connection_births WHERE exited_at IS NOT NULL AND exit_digest=identity')).toHaveLength(1);
    } finally { globalThis.fetch = request; await f?.drop(); }
  });

  test('a missing replica or mismatched original birth is not an exit proof; only the original private exit permits progress', async () => {
    const f = await sessionDeletionFixture();
    try {
      const id = f.task(), history = sessionConnectionHistory(f.database.db, f.source), privateKey = 'original private key';
      const birth = await history.open(id, () => history.birth({ id: newResourceId(), taskId: id, replica: 'http://127.0.0.1:1', at: new Date().toISOString(), exitKeyHash: jsonHash(privateKey) }));
      const context = await f.context(), owner = f.first.module.api.deletionOwner!;
      expect((await owner.run(context)).kind).toBe('done');
      expect(await owner.run({ ...context, phase: 'stop' })).toMatchObject({ kind: 'waiting' });
      expect(await f.database.db.execute('SELECT id FROM session.connection_births WHERE exited_at IS NOT NULL')).toHaveLength(0);
      await expect(history.exit(birth, 'wrong private key')).rejects.toThrow('私有许可');
      await expect(f.second.module.api.closeProjectDeletionTransport!({ ...context, phase: 'stop' }, birth.id)).rejects.toThrow('副本');
      await expect(f.database.db.execute(sql`UPDATE session.connection_births SET exited_at=now(),exit_digest=identity WHERE id=${birth.id}`).then(() => undefined)).rejects.toMatchObject({ cause: { message: expect.stringContaining('private') } });
      await history.exit(birth, privateKey);
      expect((await owner.run({ ...context, phase: 'stop' })).kind).toBe('done');
      await history.exit(birth, privateKey);
    } finally { await f.drop(); }
  });

  test('unresolved/shared ownership, legacy connections and an unregistered content table block rather than disappear from inventory', async () => {
    const f = await sessionDeletionFixture();
    try {
      const id = f.task(); await f.seed(id); const owner = f.first.module.api.deletionOwner!;
      const original = f.origins.get(id)!; f.origins.delete(id); expect((await owner.inspect(f.target)).complete).toBe(false);
      f.origins.set(id, { ...original, projectIds: [f.projectId, f.otherProject] }); expect((await owner.inspect(f.target)).complete).toBe(false);
      f.origins.set(id, original);
      await f.database.db.execute(sql`INSERT INTO session.connections(task_id,replica,connected_at,last_seen_at) VALUES(${id},'http://old',now(),now())`);
      expect((await owner.inspect(f.target)).blockers[0]?.message).toContain('旧连接');
      await f.database.db.execute('DELETE FROM session.connections');
      await f.database.db.execute('CREATE TABLE session.unregistered(task_id text,private_payload text)');
      expect((await owner.inspect(f.target)).blockers[0]?.message).toContain('完整登记');
      expect(await f.database.db.execute('SELECT task_id FROM session.runner_events')).toHaveLength(1);
      const unresolved = TaskIdSchema.parse(newResourceId());
      await expect(sessionConnectionHistory(f.database.db, f.source).open(unresolved, async () => undefined)).rejects.toThrow('归属');
    } finally { await f.drop(); }
  });

  test('metadata deletion is atomic when a late table fails and a durable stop receipt cannot be overwritten', async () => {
    const f = await sessionDeletionFixture();
    try {
      const id = f.task(); await f.seed(id); const context = await f.context(), owner = f.first.module.api.deletionOwner!;
      for (const phase of PROJECT_DELETION_PHASES.slice(0, 5)) expect((await owner.run({ ...context, phase })).kind).toBe('done');
      await f.database.db.execute("CREATE FUNCTION session.test_reject() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'late metadata failure';END $$");
      await f.database.db.execute('CREATE TRIGGER test_late BEFORE DELETE ON session.development_usage_streams FOR EACH ROW EXECUTE FUNCTION session.test_reject()');
      await expect(owner.run({ ...context, phase: 'metadata' })).rejects.toMatchObject({ cause: { message: expect.stringContaining('late metadata') } });
      expect(await f.database.db.execute('SELECT task_id FROM session.runner_events')).toHaveLength(1);
      const repository = sessionDeletionRepository(f.database.db, f.source), proof = await repository.proof({ ...context, phase: 'stop' });
      await expect(repository.record({ ...context, phase: 'stop' }, { ...proof!, digest: jsonHash('different proof') })).rejects.toThrow('不可替换');
      await f.database.db.execute('DROP TRIGGER test_late ON session.development_usage_streams');
      expect((await owner.run({ ...context, phase: 'metadata' })).kind).toBe('done');
      expect((await owner.run({ ...context, phase: 'verify' })).kind).toBe('done');
      const alternate = sessionDeletionOwner(repository, { close: async () => false }, f.source);
      expect((await alternate.inspect(f.target)).resources).toEqual([]);
    } finally { await f.drop(); }
  });
  test('legacy task aliases bind the canonical task before original birth, and a missing admitted scope cannot forge birth', async () => {
    const f = await sessionDeletionFixture();
    try {
      const id = f.task(), alias = 'legacy-runner-task'; f.origins.set(alias, f.origins.get(id)!);
      const history = sessionConnectionHistory(f.database.db, f.source), input = { id: newResourceId(), taskId: id, replica: f.first.address, at: new Date().toISOString(), exitKeyHash: jsonHash('private key') };
      await expect(history.birth(input)).rejects.toThrow('受理 scope');
      const birth = await history.open(alias as typeof id, () => history.birth(input));
      expect(birth.taskId).toBe(id); await history.exit(birth, 'private key');
      await f.database.db.execute(sql`UPDATE session.connections SET last_seen_at=now() WHERE task_id=${id}`);
      expect((await f.context()).confirmed.complete).toBe(true);
    } finally { await f.drop(); }
  });
});
