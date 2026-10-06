import { expect, test } from 'bun:test';
import type { Actor, ProjectDeletionCurrentAssets } from '@crewstation/contracts';
import { jsonHash, newResourceId } from '@crewstation/kernel';
import { testDatabaseAvailable } from '@crewstation/testkit';
import { sql } from 'drizzle-orm';
import { businessOperatorRepairs } from '../../adapters/persistence/deletion/operatorRepairs';
import { businessDeletionRepository } from '../../adapters/persistence/deletion/repository';
import { businessWorkFixture } from './workFixture';

const available = await testDatabaseAvailable();
test.skipIf(!available)('administrator review reaches every foreign child beyond the SQL cursor threshold while preserving original contents', async () => {
  const f = await businessWorkFixture(), task = newResourceId(), runtime = newResourceId(), ids = Array.from({ length: 601 }, () => newResourceId()).sort();
  const assets: ProjectDeletionCurrentAssets = { inspect: async () => ({ complete: true, digest: jsonHash('full-original-child-source'), activeConsumers: [], targetReferences: [] }) };
  try {
    await f.database.db.execute(sql`INSERT INTO business_task.tasks(id,service_id,project_id,caller_identity,state,trace_id,volume_mode,profile,labels,created_at,updated_at)
      VALUES(${task},${f.otherService},${f.otherProject},'foreign','closed','trace','persistent','profile','{}',now(),now())`);
    await f.database.db.execute(sql`INSERT INTO business_task.subtasks(id,task_id,name,kind,state,attempt,spec,created_at)
      SELECT value,${task},'unknown-runtime','agent','failed',1,${JSON.stringify({ execution: { taskId: runtime } })}::jsonb,now() FROM jsonb_array_elements_text(${JSON.stringify(ids)}::jsonb)`);
    const read = () => f.database.db.execute(sql`SELECT to_jsonb(r) AS body FROM business_task.subtasks r ORDER BY id`), original = [...await read()];
    const items = await businessOperatorRepairs(f.database.db, f.sources, assets).inspect(f.context().target);
    expect(items.map((item) => item.key)).toEqual(ids.map((id) => 'subtasks:' + JSON.stringify([id])));
    expect(items.every((item) => item.allowedDecisions.join() === 'retain' && item.confirmed === null)).toBe(true);
    expect([...await read()]).toEqual(original);
  } finally { await f.drop(); }
}, 30_000);

test.skipIf(!available)('reviewed whole foreign child is retained without restoring its missing runtime; receipts are immutable, target/content/evidence bound and restartable', async () => {
  const f = await businessWorkFixture(), id = newResourceId(), task = newResourceId(), runtime = newResourceId();
  let active = false;
  const assets: ProjectDeletionCurrentAssets = { inspect: async () => ({ complete: true, digest: jsonHash({ active }), activeConsumers: active ? ['original-consumer'] : [], targetReferences: [] }) };
  const sources = { ...f.sources, currentAssets: assets }, target = f.context().target, actor: Actor = { userId: newResourceId() as Actor['userId'], isAdmin: true };
  try {
    await f.database.db.execute(sql`INSERT INTO business_task.tasks(id,service_id,project_id,caller_identity,state,trace_id,volume_mode,profile,labels,created_at,updated_at)
      VALUES(${task},${f.otherService},${f.otherProject},'foreign','closed','trace','persistent','profile','{}',now(),now())`);
    await f.database.db.execute(sql`INSERT INTO business_task.subtasks(id,task_id,name,kind,state,attempt,spec,created_at) VALUES(${id},${task},'unknown-runtime','agent','failed',1,${JSON.stringify({ execution: { taskId: runtime } })}::jsonb,now())`);
    const body = () => f.database.db.execute(sql`SELECT to_jsonb(r) AS body FROM business_task.subtasks r WHERE id=${id}`), original = [...await body()];
    const repair = () => businessOperatorRepairs(f.database.db, sources, assets), repo = () => businessDeletionRepository(f.database.db, sources);
    await expect(repo().inspect(target)).rejects.toThrow('缺少原项目');
    const [item] = await repair().inspect(target); expect(item!.allowedDecisions).toEqual(['retain']); expect(item!.confirmed).toBeNull();
    const request = { owner: item!.owner, key: item!.key, originalDigest: item!.originalDigest, evidenceDigest: item!.evidenceDigest, decision: 'retain' as const };
    await expect(repair().confirm(target, { ...actor, isAdmin: false }, request)).rejects.toThrow();
    await expect(repair().confirm({ ...target, id: f.otherProject }, actor, request)).rejects.toThrow();
    expect((await repair().confirm(target, actor, request)).confirmed?.actorId).toBe(actor.userId);
    expect((await repair().confirm(target, actor, request)).confirmed?.actorId).toBe(actor.userId);
    expect((await repo().inspect(target)).inventory.complete).toBe(true); expect([...await body()]).toEqual(original);
    expect(await sources.resolve('task', runtime, 'current')).toBeUndefined();
    await expect(f.database.db.execute(sql`DELETE FROM business_task.operator_confirmations`).then(() => undefined)).rejects.toThrow();
    await expect(f.database.db.execute(sql`UPDATE business_task.operator_confirmations SET decision='reclaim'`).then(() => undefined)).rejects.toThrow();
    active = true; await expect(repair().confirm(target, actor, request)).rejects.toThrow(); await expect(repo().inspect(target)).rejects.toThrow(); active = false;
    await f.database.db.execute(sql`UPDATE business_task.subtasks SET output='changed-whole-record' WHERE id=${id}`);
    expect((await repair().inspect(target))[0]!.confirmed).toBeNull(); await expect(repair().confirm(target, actor, request)).rejects.toThrow(); await expect(repo().inspect(target)).rejects.toThrow();
  } finally { await f.drop(); }
});
