import { describe, expect, test } from 'bun:test';
import { PROJECT_DELETION_PHASES } from '@crewstation/contracts';
import { newResourceId } from '@crewstation/kernel';
import { testDatabaseAvailable } from '@crewstation/testkit';
import { sql } from 'drizzle-orm';
import { BUSINESS_CONTENT } from '../../adapters/persistence/deletion/contentTables';
import { businessOwnerFixture } from './ownerFixture';

const available = await testDatabaseAvailable();
describe.skipIf(!available)('business seven-phase content owner (actual PostgreSQL; controlled physical source ports)', () => {
  test('all 25 tables and more than one page are fenced, removed and compacted; restart reuses durable proofs and preserves another project', async () => {
    const f = await businessOwnerFixture();
    try {
      await f.seed();
      const rows = Array.from({ length: 205 }, () => ({ id: newResourceId(), material: newResourceId() }));
      await f.database.db.execute(sql`INSERT INTO business_task.tasks(id,service_id,project_id,caller_identity,state,trace_id,volume_mode,profile,labels,created_at,updated_at)
        SELECT x.id,${f.serviceId},${f.projectId},'private-history','closed','private-trace','persistent','private-profile','{}',now(),now() FROM jsonb_to_recordset(${JSON.stringify(rows)}::jsonb) x(id text,material text)`);
      await f.database.db.execute(sql`INSERT INTO business_task.execution_materials(id,service_id,task_id,request_key,digest,sealed,size_bytes,created_at)
        SELECT x.material,${f.serviceId},x.id,x.id,${'a'.repeat(64)},'private-history-content',64,now() FROM jsonb_to_recordset(${JSON.stringify(rows)}::jsonb) x(id text,material text)`);
      const inspected = await f.repo().inspect(f.target);
      expect(inspected.inventory.complete).toBe(true); expect(inspected.inventory.resources).toHaveLength(25);
      expect(inspected.scope.count).toBe(435);
      const inventory = inspected.inventory, confirmed = f.context(inventory);
      expect((await f.owner().run(confirmed)).kind).toBe('done');
      for (const entry of BUSINESS_CONTENT) {
        const key = sql.raw('jsonb_build_array(' + entry.keys.join(',') + ')::text');
        const item = inspected.scope.contents.find((value) => value.table === entry.table)!;
        await expect(f.database.db.execute(sql`UPDATE ${sql.raw('business_task.' + entry.table)} SET ${sql.raw(entry.keys[0]!)}=${sql.raw(entry.keys[0]!)} WHERE ${key}=${item.key}`).then(() => undefined)).rejects.toThrow();
      }
      await expect(f.owner().run(f.context(inventory, 'metadata'))).rejects.toThrow('前一阶段');
      for (const phase of PROJECT_DELETION_PHASES.slice(1)) {
        const result = await f.owner().run(f.context(inventory, phase)); expect(result.kind).toBe('done');
        expect(await f.owner().run(f.context(inventory, phase))).toEqual(result);
      }
      const scope = await f.repo().scope(f.context(inventory, 'verify'));
      expect(scope).toMatchObject({ compacted: true, count: 435, contents: [], callbacks: [] });
      expect(JSON.stringify(scope)).not.toContain('private');
      expect((await f.owner().inspect(confirmed.target)).resources).toHaveLength(0);
      const remaining = await f.database.db.execute<{ project_id: string }>(sql`SELECT project_id FROM business_task.tasks`);
      expect([...remaining]).toEqual([{ project_id: f.otherProject }]);
      await expect(f.database.db.execute(sql`INSERT INTO business_task.contracts(release_id,service_id,tag,agent_profiles,output_contracts,registered_at) VALUES(${newResourceId()},${f.serviceId},'late','{}','{}',now())`).then(() => undefined)).rejects.toThrow();
      await expect(f.database.db.execute(sql`INSERT INTO business_task.cluster_commands(id,body) VALUES(${newResourceId()},${JSON.stringify({ operation: { target: { taskId: 'historical-business-task' } } })}::jsonb)`).then(() => undefined)).rejects.toThrow();
      await expect(f.database.db.execute(sql`INSERT INTO business_task.subtask_projections(subtask_id) VALUES(${f.child})`).then(() => undefined)).rejects.toThrow();
      await expect(f.database.db.execute('TRUNCATE business_task.content_origins').then(() => undefined)).rejects.toThrow();
    } finally { await f.drop(); }
  }, 15000);

  test('a disconnected original request blocks stop until its own finally; a single container stop cannot substitute', async () => {
    const f = await businessOwnerFixture(), entered = Promise.withResolvers<void>(), release = Promise.withResolvers<void>();
    let running: Promise<unknown> | undefined;
    try {
      running = f.work.run(f.input(), async () => { entered.resolve(); await release.promise; });
      const rejected = running.catch((error: unknown) => error); await entered.promise;
      const [birth] = await f.work.history(f.projectId);
      await f.database.db.execute(sql`SELECT pg_terminate_backend(${birth!.backendPid})`); expect(await rejected).toBeInstanceOf(Error);
      const confirmed = await f.owner().inspect(f.target); expect(confirmed.complete).toBe(true);
      expect((await f.owner().run(f.context(confirmed))).kind).toBe('done');
      expect((await f.owner().run(f.context(confirmed, 'stop'))).kind).toBe('waiting');
      f.containerStopped(true); expect((await f.owner().run(f.context(confirmed, 'stop'))).kind).toBe('waiting');
      release.resolve(); await f.waitExit(birth!.id);
      expect((await f.owner().inspect(f.context(confirmed).target)).revision).toBe(confirmed.revision);
      expect((await f.owner().run(f.context(confirmed, 'stop'))).kind).toBe('done');
    } finally { release.resolve(); await running?.catch(() => undefined); await f.drop(); }
  });

  test('changed confirmation keeps admission closed, accepts only a later original generation, and rejects proof or scope replacement', async () => {
    const f = await businessOwnerFixture();
    try {
      await f.seed(); const target = f.target, before = await f.owner().inspect(target);
      await f.database.db.execute(sql`UPDATE business_task.execution_materials SET sealed='private-changed-content' WHERE task_id=${f.task}`);
      expect((await f.owner().run(f.context(before))).kind).toBe('blocked');
      await expect(f.database.db.execute(sql`UPDATE business_task.execution_controls SET body='{}' WHERE service_id=${f.serviceId}`).then(() => undefined)).rejects.toThrow();
      const current = await f.owner().inspect(target);
      await expect(f.owner().run(f.context(current))).rejects.toThrow('世代');
      expect((await f.owner().run(f.context(current, 'seal', 2))).kind).toBe('done');
      await expect(f.repo().record(f.context(current, 'seal', 2), { kind: 'metadata', count: 0, digest: 'a'.repeat(64), description: 'false replacement' })).rejects.toThrow('不能替换');
      await expect(f.database.db.execute(sql`UPDATE business_task.project_deletions SET body='{}' WHERE project_id=${f.projectId}`).then(() => undefined)).rejects.toThrow();
      await expect(f.owner().run({ ...f.context(current, 'stop', 2), operationId: newResourceId() })).rejects.toThrow();
    } finally { await f.drop(); }
  });

  test('missing or conflicting sources and late grant revocation produce no completed seal', async () => {
    const f = await businessOwnerFixture();
    try {
      await f.seed(); const target = f.target;
      const original = f.origins.get(f.serviceId)!; f.origins.delete(f.serviceId);
      expect(await f.owner().inspect(target)).toMatchObject({ complete: false, blockers: [{ code: 'source-unavailable' }] });
      f.origins.set(f.serviceId, original); const confirmed = await f.owner().inspect(target);
      let grants = 0; f.checkingGrant(async () => { if (++grants === 3) f.permit(false); });
      await expect(f.owner().run(f.context(confirmed))).rejects.toThrow('grant-unavailable');
      expect(await f.database.db.execute(sql`SELECT project_id FROM business_task.project_admissions`)).toHaveLength(0);
      expect(await f.database.db.execute(sql`SELECT project_id FROM business_task.project_deletions`)).toHaveLength(0);
    } finally { await f.drop(); }
  });
});
