import { afterEach, describe, expect, test } from 'bun:test';
import { PROJECT_DELETION_PHASES } from '@crewstation/contracts';
import type { ProjectDeletionInventory, ProjectId, TaskId, UsageExecutionIdentity } from '@crewstation/contracts';
import { ExecutionObservationIdentitySchema, UserIdSchema } from '@crewstation/contracts';
import { jsonHash, newResourceId } from '@crewstation/kernel';
import { connectDatabase, resourceIdentityDirectory, withExclusiveDatabaseAdmission } from '@crewstation/persistence';
import { testDatabaseAvailable } from '@crewstation/testkit';
import type { TestDatabase } from '@crewstation/testkit';
import { sql } from 'drizzle-orm';
import type { SQL } from 'drizzle-orm';
import { observabilityDeletionRepository } from '../adapters/persistence/projectDeletion';
import { observabilityDeletionOwner } from '../application/projectDeletion';
import { drizzleUsageLedger, drizzleExecutionValuations } from '../adapters/persistence/drizzleUsageLedger';
import { drizzleAlertRepository } from '../adapters/persistence/drizzleRepositories';
import { drizzleCostVisibility, drizzleExecutionPricing, drizzleTokenPriceStore } from '../adapters/persistence/drizzleTokenPricing';
import { usageSnapshot } from '../adapters/persistence/usageSnapshot';
import { observabilityMigrations, createObservabilityModule } from '../wiring';
import { createFakeK8sClient } from '@crewstation/k8s';
import { createApp } from '@crewstation/http';
import { target, otherId, fixture, insertRow, seed, contentCounts } from './projectDeletionFixture';

const available = await testDatabaseAvailable();
let database: TestDatabase | undefined;
afterEach(async () => { const original = database; database = undefined; await original?.drop(); }, 15_000);
const raw = async (statement: SQL) => await database!.db.execute(statement);
async function setup(legacy = false) { const f = await fixture(legacy); database = f.database; return f; }
async function stages(f: Awaited<ReturnType<typeof setup>>, confirmed: ProjectDeletionInventory, generation = 1) {
  for (const phase of PROJECT_DELETION_PHASES) expect((await f.owner.run(f.context(confirmed, phase, generation))).kind).toBe('done');
}

describe.skipIf(!available)('observability project permanent cleanup', () => {
  test('首次目标证明允许 deleting 的状态修订，所有实体字段变化或原来源缺失仍阻断', async () => {
    const f = await setup(); await seed(database!, target.id); await seed(database!, otherId);
    const confirmed = await f.owner.inspect(target);
    expect((await f.owner.run(f.context(confirmed, 'seal'))).kind).toBe('done');
    // 2026-10-07 实机原屏障保存 active/revision 4；重新确认读取 deleting/revision 5。
    const current = { ...target, state: 'deleting' as const, revision: '2' };
    const restored = observabilityDeletionOwner(observabilityDeletionRepository({ ...f.input, originalTarget: async () => target }));
    expect(await restored.inspect(current)).toEqual(confirmed);
    await expect(f.owner.inspect(current)).rejects.toThrow('原项目');
    const missing = observabilityDeletionOwner(observabilityDeletionRepository({ ...f.input, originalTarget: async () => undefined }));
    await expect(missing.inspect(current)).rejects.toThrow('原项目');
    const wrong = observabilityDeletionOwner(observabilityDeletionRepository({ ...f.input, originalTarget: async () => ({ ...target, revision: '99' }) }));
    await expect(wrong.inspect(current)).rejects.toThrow('原项目');
    for (const field of ['slug', 'name', 'namespace', 'prodHost', 'previewHost', 'serviceHost'] as const) {
      await expect(restored.inspect({ ...current, [field]: 'replacement' })).rejects.toThrow('原项目');
    }
    for (const phase of PROJECT_DELETION_PHASES) expect((await restored.run({ ...f.context(confirmed, phase, 2), target: current })).kind).toBe('done');
    expect((await contentCounts(database!)).usage_heads).toBe(1);
  });
  test('clears all twenty content tables without query caps, preserves another project and platform prices, and blocks late writes', async () => {
    const f = await setup(), own = await seed(database!, target.id), other = await seed(database!, otherId);
    await raw(sql`INSERT INTO observability.alerts(id,project_id,type,key,state,detail,fired_at) SELECT 'dense-' || value,${target.id},'health-failing','health-failing:prod','firing','private-dense',now() FROM generate_series(1,2001) AS value`);
    const profileId = newResourceId(), prices = drizzleTokenPriceStore(database!.db);
    await prices.change(profileId, async (store) => {
      await store.append({ id: newResourceId(), profileId, profileRevision: 1, revision: 1, protocol: 'opencode', provider: 'provider', model: 'model', condition: null,
        effectiveFrom: new Date().toISOString(), createdAt: new Date().toISOString(), createdBy: UserIdSchema.parse(newResourceId()), currency: 'CNY', rates: { input: '1', output: '2', cacheRead: '3', cacheWrite: '4' }, sourceNote: 'platform' }, newResourceId(), 'platform-price');
    });
    const confirmed = await f.owner.inspect(target); expect(confirmed.complete).toBe(true); expect(confirmed.resources).toHaveLength(20);
    expect(confirmed.resources.reduce((sum, row) => sum + row.count, 0)).toBe(2021); expect(JSON.stringify(confirmed)).not.toContain('private-');
    const restored = observabilityDeletionOwner(observabilityDeletionRepository(f.input));
    expect((await restored.run(f.context(confirmed, 'seal'))).kind).toBe('done');
    for (const phase of PROJECT_DELETION_PHASES.slice(1)) {
      const result = await f.owner.run(f.context(confirmed, phase)); expect(result.kind).toBe('done');
      if (phase === 'metadata') expect(await restored.run(f.context(confirmed, phase))).toEqual(result);
    }
    const counts = await contentCounts(database!);
    for (const name of Object.keys(own.rows)) expect(counts[name]).toBe(1);
    expect(counts.token_prices).toBe(1); expect(counts.token_price_heads).toBe(1);
    for (const [name, value] of Object.entries(other.rows)) {
      const stored = await database!.db.execute<{ body: Record<string, unknown> }>(sql`SELECT to_jsonb(${sql.identifier(name)}) AS body FROM ${sql.identifier('observability')}.${sql.identifier(name)}`);
      const body = stored[0]!.body;
      if (typeof body.fired_at === 'string') body.fired_at = new Date(body.fired_at).toISOString();
      expect(jsonHash(body)).toBe(jsonHash(value));
    }
    expect((await f.owner.inspect(target)).resources).toEqual([]);
    expect(await f.owner.run(f.context(confirmed, 'verify'))).toEqual(await restored.run(f.context(confirmed, 'verify')));
    for (const [name, value] of Object.entries(own.rows)) await expect(insertRow(database!, name, value)).rejects.toThrow();
    const ledger = drizzleUsageLedger(database!.db), scope = { projectId: target.id, taskId: own.taskId as TaskId };
    await expect(ledger.snapshot(scope, { limit: 50 }, 1, 0)).rejects.toThrow();
    await expect(ledger.change(scope, 'late', async () => undefined)).rejects.toThrow();
    await expect(drizzleAlertRepository(database!.db).fire({ id: newResourceId(), projectId: target.id, type: 'health-failing', key: 'health-failing:prod', state: 'firing', detail: 'late', firedAt: new Date() })).rejects.toThrow();
    await expect(drizzleAlertRepository(database!.db).resolve(target.id, 'health-failing:prod', new Date())).rejects.toThrow();
    await expect(drizzleCostVisibility(database!.db).save(target.id, { expectedRevision: 0, requestKey: newResourceId(), visibility: 'project-members-and-services' }, new Date())).rejects.toThrow();
    await expect(raw(sql`DELETE FROM observability.deletion_entities WHERE project_id=${target.id}`)).rejects.toThrow();
    await expect(raw(sql`UPDATE observability.deletion_fences SET original='{}'::jsonb WHERE project_id=${target.id}`)).rejects.toThrow();
    await expect(insertRow(database!, 'usage_sources', { task_key: own.taskKey, source_id: 'new-late', cursor: null })).rejects.toThrow();
    await expect(insertRow(database!, 'usage_heads', { task_key: jsonHash({ projectId: otherId, taskId: own.taskId }), project_id: otherId, task_id: own.taskId, sequence: 0 })).rejects.toThrow();
  }, 30_000);

  test('failed confirmation persists closure until a new generation, preserves stage order and rejects foreign grants', async () => {
    const f = await setup(); await seed(database!, target.id);
    const confirmed = await f.owner.inspect(target);
    await insertRow(database!, 'alerts', { id: newResourceId(), project_id: target.id, type: 'health-failing', key: 'health-failing:preview', state: 'firing', detail: 'changed', fired_at: new Date().toISOString() });
    expect((await f.owner.run(f.context(confirmed, 'seal'))).kind).toBe('blocked');
    expect((await f.owner.run(f.context(confirmed, 'seal'))).kind).toBe('blocked');
    await expect(f.owner.run(f.context(confirmed, 'stop'))).rejects.toThrow('确认');
    const current = await f.owner.inspect(target);
    expect((await f.owner.run(f.context(current, 'seal', 2))).kind).toBe('done');
    await expect(f.owner.run(f.context(current, 'metadata', 2))).rejects.toThrow('前序');
    await expect(f.owner.run(f.context(current, 'stop', 1))).rejects.toThrow('世代');
    await expect(f.owner.run({ ...f.context(current, 'stop', 2), operationId: newResourceId() })).rejects.toThrow('wrong operation');
    await expect(f.owner.run({ ...f.context(current, 'stop', 2), target: { ...target, namespace: 'replacement' } })).rejects.toThrow('原项目');
    await expect(f.owner.run({ ...f.context(current, 'stop', 2), confirmed: { ...current, revision: 'a'.repeat(64) } })).rejects.toThrow('确认');
    for (const phase of PROJECT_DELETION_PHASES.slice(1)) expect((await f.owner.run(f.context(current, phase, 2))).kind).toBe('done');
    await expect(f.owner.run(f.context(current, 'seal', 3))).rejects.toThrow('完成');
  });

  test('old zero-usage snapshots require an independent complete task source; new snapshots persist their original ownership', async () => {
    const f = await setup(true), taskId = newResourceId(), taskKey = jsonHash({ projectId: target.id, taskId });
    // Historically a snapshot inserted only its opaque hash, so it could not be attributed after task deletion.
    await usageSnapshot(database!.db, taskKey, { limit: 50 }, 1, 0);
    await f.upgrade();
    expect((await f.owner.inspect(target)).blockers.map((row) => row.code)).toContain('observability-orphan');
    const incomplete = observabilityDeletionOwner(observabilityDeletionRepository({ ...f.input, tasks: { list: async () => ({ ids: [taskId], complete: false }) } }));
    expect((await incomplete.inspect(target)).complete).toBe(false);
    const complete = observabilityDeletionOwner(observabilityDeletionRepository({ ...f.input, tasks: { list: async () => ({ ids: [taskId], complete: true }) } }));
    const confirmed = await complete.inspect(target); expect(confirmed.complete).toBe(true); expect(confirmed.resources[0]?.kind).toBe('usage_snapshots');
    for (const phase of PROJECT_DELETION_PHASES) expect((await complete.run(f.context(confirmed, phase))).kind).toBe('done');
    await expect(insertRow(database!, 'usage_heads', { task_key: jsonHash({ projectId: otherId, taskId }), project_id: otherId, task_id: taskId, sequence: 0 })).rejects.toThrow();
    const otherTaskId = newResourceId() as TaskId;
    await drizzleUsageLedger(database!.db).snapshotWithCaptures({ projectId: otherId as ProjectId, taskId: otherTaskId }, { limit: 50 }, 2, 0);
    expect((await raw(sql`SELECT project_id,task_id FROM observability.usage_heads`))[0]).toEqual({ project_id: otherId, task_id: otherTaskId });
    expect((await f.owner.inspect(target)).complete).toBe(true);
  });

  test('uses verified legacy aliases and blocks conflicting ownership or unknown content instead of declaring empty', async () => {
    const f = await setup(true); await f.input.identities.bind('observability', 'project', ['old-project'], target.id);
    await seed(database!, 'old-project'); await seed(database!, otherId); await f.upgrade();
    const confirmed = await f.owner.inspect(target); expect(confirmed.complete).toBe(true); await stages(f, confirmed);
    expect((await contentCounts(database!)).usage_heads).toBe(1);
    const bad = observabilityDeletionOwner(observabilityDeletionRepository({ ...f.input, identities: { aliases: async () => [['old-project']], resolve: async () => otherId } }));
    await expect(bad.inspect(target)).rejects.toThrow('冲突');
    await raw(sql`ALTER TABLE observability.alerts ADD COLUMN unexplained_content text`);
    await expect(f.owner.inspect(target)).rejects.toThrow('内容表');
  });

  test('waits for the actual SQL callback while unrelated projects continue, then seals without changing the confirmed content', async () => {
    const f = await setup(), ledger = drizzleUsageLedger(database!.db), scope = { projectId: target.id, taskId: newResourceId() as TaskId };
    await ledger.change(scope, 'original', async (tx) => tx.advance('1', 'first'));
    const confirmed = await f.owner.inspect(target);
    let release!: () => void, entered!: () => void;
    const hold = new Promise<void>((resolve) => { release = resolve; }), started = new Promise<void>((resolve) => { entered = resolve; });
    const original = ledger.change(scope, 'original', async (tx) => { entered(); await hold; return tx.cursor(); });
    await started;
    let settled = false;
    const sealing = f.owner.run(f.context(confirmed, 'seal')).then((result) => { settled = true; return result; });
    await ledger.change({ projectId: otherId as ProjectId, taskId: newResourceId() as TaskId }, 'unrelated', async (tx) => tx.advance('1', 'other'));
    expect(settled).toBe(false); release(); expect(await original).toBe('1'); expect((await sealing).kind).toBe('done');
    await expect(ledger.change(scope, 'original', async (tx) => tx.advance('2', 'late'))).rejects.toThrow();
  });

  test('old cross-project content and a contradictory historical task directory cannot authorize deletion', async () => {
    const f = await setup(true), own = await seed(database!, target.id), other = await seed(database!, otherId);
    await raw(sql`UPDATE observability.usage_projections SET document=${JSON.stringify({ identity: { projectId: target.id, taskId: own.taskId, executionId: own.executionId } })}::jsonb WHERE task_key=${other.taskKey}`);
    await f.upgrade();
    const confirmed = await f.owner.inspect(target);
    expect(confirmed.complete).toBe(false); expect(confirmed.blockers.map((row) => row.code)).toContain('observability-ownership-conflict');
    await expect(f.owner.run(f.context(confirmed, 'seal'))).rejects.toThrow('确认');
    expect((await contentCounts(database!)).usage_heads).toBe(2);
    const wrong = observabilityDeletionOwner(observabilityDeletionRepository({ ...f.input, tasks: { list: async () => ({ ids: [other.taskId], complete: true }) } }));
    expect((await wrong.inspect(target)).complete).toBe(false);
    expect((await contentCounts(database!)).deletion_fences).toBe(0);
  });

  test('SQL permissions require the actual owner lock and original predecessor, and ownership cannot move to another project', async () => {
    const f = await setup(), own = await seed(database!, target.id), confirmed = await f.owner.inspect(target);
    await expect(raw(sql`UPDATE observability.alerts SET project_id=${otherId} WHERE project_id=${target.id}`)).rejects.toThrow();
    expect((await f.owner.run(f.context(confirmed, 'seal'))).kind).toBe('done');
    await expect(withExclusiveDatabaseAdmission(database!.db, 'observability.project:' + target.id, async (tx) => {
      await tx.execute(sql`SELECT set_config('crewstation.observability_deletion',${f.operationId + ':1:metadata'},true)`);
      await tx.execute(sql`UPDATE observability.deletion_fences SET phase_index=5 WHERE project_id=${target.id}`);
    })).rejects.toThrow();
    await expect(withExclusiveDatabaseAdmission(database!.db, 'observability.project:' + target.id, async (tx) => {
      await tx.execute(sql`SELECT set_config('crewstation.observability_deletion',${f.operationId + ':1:metadata'},true)`);
      await tx.execute(sql`DELETE FROM observability.usage_heads WHERE task_key=${own.taskKey}`);
    })).rejects.toThrow();
    await expect(raw(sql`UPDATE observability.deletion_entities SET project_id=${otherId} WHERE project_id=${target.id}`)).rejects.toThrow();
    await expect(raw(sql`DELETE FROM observability.deletion_fences WHERE project_id=${target.id}`)).rejects.toThrow();
    expect((await contentCounts(database!)).usage_heads).toBe(1);
    const otherAlert = newResourceId();
    await expect(raw(sql`INSERT INTO observability.alerts(id,project_id,type,key,state,detail,fired_at) VALUES
      (${otherAlert},${otherId},'health-failing','health-failing:prod','firing','unrelated',now()),
      (${newResourceId()},${target.id},'health-failing','health-failing:prod','firing','late',now())`)).rejects.toThrow();
    expect(await raw(sql`SELECT id FROM observability.alerts WHERE id=${otherAlert}`)).toHaveLength(0);
    await expect(raw(sql`INSERT INTO observability.native_steps(capture_id,task_key,record_id,native_key,root,revision,fingerprint) VALUES
      (${own.captureId},${own.taskKey},'late-first','native','root',1,'first'),(${own.captureId},${own.taskKey},'late-second','native','root',1,'second')`)).rejects.toThrow();
  });

  test('the wired internal owner works with a one-connection directory and does not create a public deletion endpoint', async () => {
    const f = await setup(), connection = connectDatabase(database!.url, { max: 1 });
    try {
      const identities = resourceIdentityDirectory(connection.db, () => [observabilityMigrations]);
      const module = createObservabilityModule({ db: connection.db, k8s: createFakeK8sClient(), isAdmin: async () => true,
        authorizer: { authorize: async () => undefined }, services: { resolveServiceOfProject: async () => undefined }, slots: { slotRoles: async () => undefined },
        traces: { environments: { traceKeys: async () => [], activeTraceIds: async () => [], list: async () => [] }, deliveries: { traceKeys: async () => [], activeTraceIds: async () => [], list: async () => [] },
          businessTasks: { list: async () => [] }, sessions: { summarize: async () => [], events: async () => [] } },
        deletion: { identities, assertGrant: f.input.assertGrant, tasks: { list: async () => { await connection.db.execute(sql`SELECT 1`); return { ids: [], complete: true }; } } },
      });
      expect(module.api.deletionOwner?.participant).toBe('observability');
      const app = createApp({ name: 'observation-cleanup-internal' });
      for (const router of module.http) app.route('/', router);
      expect((await app.request('/v1/admin/projects/' + target.id + '/deletion-plan', { method: 'POST' })).status).toBe(404);
      const owner = module.api.deletionOwner!, confirmed = await owner.inspect(target); expect(confirmed.complete).toBe(true); expect(confirmed.resources).toEqual([]);
      for (const phase of PROJECT_DELETION_PHASES) expect((await owner.run(f.context(confirmed, phase))).kind).toBe('done');
    } finally { await connection.close(); }
  });

  test('rejects normal pricing and valuation admission after seal while platform price updates remain usable', async () => {
    const f = await setup(), identity: UsageExecutionIdentity = ExecutionObservationIdentitySchema.parse({ projectId: target.id, taskId: newResourceId(), executionId: newResourceId(), executionGeneration: 1, subtaskId: newResourceId() });
    const pricing = drizzleExecutionPricing(database!.db);
    const accepted = await pricing.accept({ identity, profile: null }, new Date()); expect(accepted.identity).toEqual(identity);
    const confirmed = await f.owner.inspect(target); expect((await f.owner.run(f.context(confirmed, 'seal'))).kind).toBe('done');
    await expect(pricing.accept({ identity, profile: null }, new Date())).rejects.toThrow();
    const valuations = drizzleExecutionValuations(database!.db);
    await expect(valuations.commit({ measurement: { identity, sourceId: 'source', recordId: 'record' }, usageRevision: 1, requestKey: newResourceId(), model: null }, 'fingerprint', 'basis', {} as never)).rejects.toThrow();
    await drizzleTokenPriceStore(database!.db).change(newResourceId(), async (store) => expect(await store.head(newResourceId())).toBe(0));
    await expect(raw(sql`SELECT set_config('crewstation.observability_deletion',${f.operationId + ':1:metadata'},false); DELETE FROM observability.accepted_execution_prices`)).rejects.toThrow();
  });
});
