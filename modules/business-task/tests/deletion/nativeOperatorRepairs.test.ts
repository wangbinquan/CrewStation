import { describe, expect, test } from 'bun:test';
import { PROJECT_DELETION_PHASES, ProjectDeletionContextSchema } from '@crewstation/contracts';
import { jsonHash, newResourceId } from '@crewstation/kernel';
import { testDatabaseAvailable } from '@crewstation/testkit';
import { sql } from 'drizzle-orm';
import { inspectBusinessContent } from '../../adapters/persistence/deletion/inspection';
import { nativeRepairFixture } from './nativeRepairFixture';

const available = await testDatabaseAvailable();
describe.skipIf(!available)('reviewed native business history (actual PostgreSQL; controlled public/current sources)', () => {
  test('the whole cancelled execution and idle home require separate reviews and survive all seven target cleanup phases', async () => {
    const f = await nativeRepairFixture();
    try {
      const original = [...await f.read()], target = f.context().target;
      await expect(f.repo().inspect(target)).rejects.toThrow('缺少原项目');
      const items = await f.repair().inspect(target);
      // Real RFC-027 cancelled requests have no TaskRuntime root, yet both V3 records must remain reviewable.
      expect(items).toHaveLength(2);
      expect(items.every(item => item.allowedDecisions.join() === 'retain' && !item.confirmed)).toBe(true);
      for (const item of items) {
        const request = { owner: item.owner, key: item.key, originalDigest: item.originalDigest, evidenceDigest: item.evidenceDigest, decision: 'retain' as const };
        await expect(f.repair().confirm(target, { ...f.actor, isAdmin: false }, request)).rejects.toThrow();
        expect((await f.repair().confirm(target, f.actor, request)).confirmed?.actorId).toBe(f.actor.userId);
        expect((await f.repair().confirm(target, f.actor, request)).confirmed?.actorId).toBe(f.actor.userId);
      }
      expect(await f.sources.resolve('task', f.runtime)).toBeUndefined();
      expect([...await f.read()]).toEqual(original);
      await f.database.db.execute(sql`INSERT INTO business_task.tasks(id,service_id,project_id,caller_identity,state,trace_id,volume_mode,profile,labels,created_at,updated_at)
        VALUES(${newResourceId()},${f.serviceId},${f.projectId},'target','closed','trace','persistent','profile','{}',now(),now())`);
      const inventory = (await f.repo().inspect(target)).inventory;
      expect(inventory.complete).toBe(true); expect(inventory.resources).toHaveLength(1);
      for (const phase of PROJECT_DELETION_PHASES) {
        const context = ProjectDeletionContextSchema.parse({ ...f.context(), phase, confirmed: inventory });
        const result = await f.owner().run(context); expect(result.kind).toBe('done');
        expect(await f.owner().run(context)).toEqual(result);
      }
      expect((await f.repo().inspect(target)).scope.count).toBe(0);
      expect([...await f.read()]).toEqual(original);
      expect((await f.database.db.execute(sql`SELECT id FROM business_task.tasks`)).map(r=>r.id)).toEqual([f.task]);
      expect(JSON.stringify(await f.database.db.execute(sql`SELECT value FROM business_task.operator_confirmations`))).not.toContain('private-original-material');
    } finally { await f.drop(); }
  }, 30_000);

  test('a previously approved legacy retain also remains valid in the formal metadata purge', async () => {
    const f = await nativeRepairFixture(false);
    try {
      const original = [...await f.read()], target = f.context().target, [item] = await f.repair().inspect(target);
      await f.repair().confirm(target, f.actor, { owner: item!.owner, key: item!.key, originalDigest: item!.originalDigest, evidenceDigest: item!.evidenceDigest, decision: 'retain' });
      await expect(inspectBusinessContent(f.database.db,f.sources,target.id)).rejects.toThrow('缺少原项目');
      const inventory = (await f.repo().inspect(target)).inventory;
      for (const phase of PROJECT_DELETION_PHASES) {
        // The final reinspection must receive the same target used for its operator confirmations.
        expect((await f.owner().run({ ...f.context(), phase, confirmed: inventory })).kind).toBe('done');
      }
      expect([...await f.read()]).toEqual(original);
    } finally { await f.drop(); }
  });

  test('body, current identity, related-row and public source changes invalidate the saved whole-record review', async () => {
    const f = await nativeRepairFixture();
    try {
      const target = f.context().target, items = await f.repair().inspect(target); expect(items).toHaveLength(2);
      for (const item of items) await f.repair().confirm(target, f.actor, { owner: item.owner, key: item.key, originalDigest: item.originalDigest, evidenceDigest: item.evidenceDigest, decision: 'retain' });
      const stale = { owner: items[0]!.owner, key: items[0]!.key, originalDigest: items[0]!.originalDigest, evidenceDigest: items[0]!.evidenceDigest, decision: 'retain' as const };
      f.identity('replaced-current-identity'); expect((await f.repair().inspect(target)).every(i => i.confirmed === null)).toBe(true);
      await expect(f.repair().confirm(target, f.actor, stale)).rejects.toThrow(); await expect(f.repo().inspect(target)).rejects.toThrow(); f.identity('actual-current-source');
      await f.database.db.execute(sql`UPDATE business_task.execution_subtasks SET sealed_payload='changed-whole-material' WHERE id=${f.child}`);
      expect((await f.repair().inspect(target)).every(i => i.confirmed === null)).toBe(true); await expect(f.repo().inspect(target)).rejects.toThrow();
      await f.database.db.execute(sql`UPDATE business_task.execution_subtasks SET sealed_payload='private-original-material' WHERE id=${f.child}`);
      const source = f.origins.get(f.otherService)!; f.origins.set(f.otherService, { ...source, revision: jsonHash('changed-public-service') });
      expect((await f.repair().inspect(target)).every(i => i.confirmed === null)).toBe(true); f.origins.set(f.otherService, source);
      await f.database.db.execute(sql`INSERT INTO business_task.execution_events(service_id,task_id,sequence,subtask_id,source_sequence,digest,event)
        VALUES(${f.otherService},${f.task},1,${f.child},1,${jsonHash('new-reference')},${JSON.stringify({ runtime: f.runtime })}::jsonb)`);
      expect((await f.repair().inspect(target)).every(i => i.confirmed === null)).toBe(true); await expect(f.repair().confirm(target, f.actor, stale)).rejects.toThrow();
    } finally { await f.drop(); }
  });

  test('target, active, unknown, shared, unfinished and malformed relations remain blocked without changing original records', async () => {
    const f = await nativeRepairFixture();
    try {
      const target = f.context().target;
      const blocked = async () => { const items = await f.repair().inspect(target); expect(items.length).toBeGreaterThanOrEqual(2); expect(items.every(i => i.allowedDecisions.length === 0 && i.confirmed === null)).toBe(true); await expect(f.repo().inspect(target)).rejects.toThrow(); };
      f.active(true); await blocked(); f.active(false); f.targetReference(true); await blocked(); f.targetReference(false);
      const source = f.origins.get(f.otherService)!; f.origins.delete(f.otherService); await blocked(); f.origins.set(f.otherService, source);
      f.origins.set(f.otherService, { ...source, projectIds: [f.projectId] }); await blocked(); f.origins.set(f.otherService, source);
      await f.database.db.execute(sql`UPDATE business_task.execution_subtasks SET view=view||'{"state":"running"}'::jsonb WHERE id=${f.child}`); await blocked();
      await f.database.db.execute(sql`UPDATE business_task.execution_subtasks SET view=view||'{"state":"cancelled"}'::jsonb,runtime_released=false WHERE id=${f.child}`); await blocked();
      await f.database.db.execute(sql`UPDATE business_task.execution_subtasks SET runtime_released=true,dispatch='dispatching',owner='live-owner',lease_until=now()+interval '1 hour' WHERE id=${f.child}`); await blocked();
      await f.database.db.execute(sql`UPDATE business_task.execution_subtasks SET dispatch='accepted',owner=NULL,lease_until=NULL,view=view||${JSON.stringify({ nestedTarget: target.id })}::jsonb WHERE id=${f.child}`); await blocked();
      await f.database.db.execute(sql`UPDATE business_task.execution_subtasks SET view=view-'nestedTarget' WHERE id=${f.child}`);
      await f.database.db.execute(sql`UPDATE business_task.execution_session_homes SET state='occupied',lease_execution_id=${f.execution} WHERE session_key=${f.runtime}`); await blocked();
      await f.database.db.execute(sql`UPDATE business_task.execution_session_homes SET state='idle',lease_execution_id=NULL WHERE session_key=${f.runtime}`);
      await f.database.db.execute(sql`UPDATE business_task.execution_subtasks SET view=view||${JSON.stringify({ id: newResourceId() })}::jsonb WHERE id=${f.child}`); await blocked();
      await f.database.db.execute(sql`UPDATE business_task.execution_subtasks SET view=view||${JSON.stringify({ id: f.child })}::jsonb WHERE id=${f.child}`);
      const shared = newResourceId();
      await f.database.db.execute(sql`INSERT INTO business_task.tasks(id,service_id,project_id,caller_identity,state,trace_id,volume_mode,profile,labels,created_at,updated_at)
        VALUES(${shared},${f.serviceId},${f.projectId},'target','closed','trace','persistent','profile','{}',now(),now())`);
      await f.database.db.execute(sql`INSERT INTO business_task.execution_session_homes(session_key,service_id,task_id,volume_uid,state)
        VALUES(${newResourceId()},${f.serviceId},${shared},${f.volume},'idle')`); await blocked();
    } finally { await f.drop(); }
  }, 30_000);

  test('native session candidates after 601 complete rows are reached through the transaction cursor', async () => {
    const f = await nativeRepairFixture();
    try {
      const ids = Array.from({ length: 601 }, (_, index) => '00000000-0000-7000-8000-' + index.toString(16).padStart(12,'0'));
      for (const id of ids) f.bind(id, f.otherProject);
      await f.database.db.execute(sql`INSERT INTO business_task.execution_session_homes(session_key,service_id,task_id,volume_uid,state)
        SELECT value,${f.otherService},${f.task},'known-volume-'||value,'idle' FROM jsonb_array_elements_text(${JSON.stringify(ids)}::jsonb)`);
      const target = f.context().target, items = await f.repair().inspect(target);
      expect(items).toHaveLength(2); expect(items.every(item => item.allowedDecisions.join() === 'retain')).toBe(true);
      for (const item of items) await f.repair().confirm(target, f.actor, { owner: item.owner, key: item.key, originalDigest: item.originalDigest, evidenceDigest: item.evidenceDigest, decision: 'retain' });
      expect((await f.repo().inspect(target)).inventory.complete).toBe(true);
      expect((await f.database.db.execute(sql`SELECT session_key FROM business_task.execution_session_homes`))).toHaveLength(602);
    } finally { await f.drop(); }
  }, 30_000);
  test('a related known runtime owned by the target blocks retention even when the foreign row contains no target ID', async () => {
    const f = await nativeRepairFixture();
    try {
      const linked = newResourceId(), target = f.context().target; f.bind(linked,f.projectId);
      await f.database.db.execute(sql`INSERT INTO business_task.execution_session_homes(session_key,service_id,task_id,volume_uid,state)
        VALUES(${linked},${f.otherService},${f.task},${f.volume},'idle')`);
      const items = await f.repair().inspect(target); expect(items).toHaveLength(2);
      expect(items.every(item => item.allowedDecisions.length === 0 && item.blockers.some(blocker=>blocker.includes('运行环境')))).toBe(true);
      await expect(f.repo().inspect(target)).rejects.toThrow();
    } finally { await f.drop(); }
  });

  test('literal reference identifiers and unavailable current sources cannot silently exclude related records', async () => {
    const f = await nativeRepairFixture();
    try {
      const volume = 'literal_%_\\.volume', target = f.context().target;
      await f.database.db.execute(sql`UPDATE business_task.execution_session_homes SET volume_uid=${volume} WHERE session_key=${f.runtime}`);
      await f.database.db.execute(sql`UPDATE business_task.execution_subtasks SET session_volume_uid=${volume} WHERE id=${f.child}`);
      const items = await f.repair().inspect(target); expect(items).toHaveLength(2); expect(items.every(item => item.allowedDecisions.join() === 'retain')).toBe(true);
      f.assets.inspect = async () => { throw new Error('actual current source unavailable'); };
      await expect(f.repair().inspect(target)).rejects.toThrow('actual current source unavailable');
      await expect(f.repo().inspect(target)).rejects.toThrow('actual current source unavailable');
    } finally { await f.drop(); }
  });
});
