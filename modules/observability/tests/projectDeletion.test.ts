// RFC-037 项目删除的 observability 参与方（RFC-034 v2）：本模块的项目内容只有告警、Agent 执行（含按模型用量）与
// 项目费用可见性，都直接带 project_id；按项目封写、固定范围、删除与核对，平台执行与价格线不属于项目而保留。
import { afterEach, describe, expect, test } from 'bun:test';
import { PROJECT_DELETION_PHASES } from '@crewstation/contracts';
import type { ProjectDeletionInventory, ProjectId } from '@crewstation/contracts';
import { jsonHash, newResourceId } from '@crewstation/kernel';
import { connectDatabase, resourceIdentityDirectory } from '@crewstation/persistence';
import { testDatabaseAvailable } from '@crewstation/testkit';
import type { TestDatabase } from '@crewstation/testkit';
import { sql } from 'drizzle-orm';
import type { SQL } from 'drizzle-orm';
import { observabilityDeletionRepository } from '../adapters/persistence/projectDeletion';
import { observabilityDeletionOwner } from '../application/projectDeletion';
import { drizzleAgentCallStore } from '../adapters/persistence/agentCallStore';
import { drizzleAlertRepository } from '../adapters/persistence/drizzleRepositories';
import { drizzleCostVisibilityStore, drizzlePriceStore } from '../adapters/persistence/observationPricingStore';
import { createAgentCallRecorder } from '../application/agentCallRecorder';
import { observabilityMigrations, createObservabilityModule } from '../wiring';
import { createFakeK8sClient } from '@crewstation/k8s';
import { createApp } from '@crewstation/http';
import { agentCallRow, target, otherId, fixture, insertRow, seed, contentCounts } from './projectDeletionFixture';

const available = await testDatabaseAvailable();
let database: TestDatabase | undefined;
afterEach(async () => { const original = database; database = undefined; await original?.drop(); }, 15_000);
const raw = async (statement: SQL) => await database!.db.execute(statement);
async function setup() { const f = await fixture(); database = f.database; return f; }
async function stages(f: Awaited<ReturnType<typeof setup>>, confirmed: ProjectDeletionInventory, generation = 1) {
  for (const phase of PROJECT_DELETION_PHASES) expect((await f.owner.run(f.context(confirmed, phase, generation))).kind).toBe('done');
}
const call = (projectId: ProjectId) => ({ projectId, source: 'business' as const, kind: 'subtask' as const, taskId: newResourceId(), taskLabel: 'late', subtaskId: newResourceId(),
  attempt: 1, runtimeTaskId: newResourceId(), agentId: newResourceId(), agentKey: 'agent', agentLabel: 'Agent', protocol: 'opencode', profile: null });

describe.skipIf(!available)('observability project permanent cleanup (RFC-034 v2 content)', () => {
  test('首次目标证明允许 deleting 的状态修订，所有实体字段变化或原来源缺失仍阻断', async () => {
    const f = await setup(); await seed(database!, target.id); await seed(database!, otherId);
    const confirmed = await f.owner.inspect(target);
    expect((await f.owner.run(f.context(confirmed, 'seal'))).kind).toBe('done');
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
    expect((await contentCounts(database!)).agent_calls).toBe(1);
  });

  test('clears alerts, Agent calls with their model rows and cost visibility without caps; keeps another project, platform calls and prices; rejects late writes', async () => {
    const f = await setup(), own = await seed(database!, target.id), other = await seed(database!, otherId);
    await raw(sql`INSERT INTO observability.alerts(id,project_id,type,key,state,detail,fired_at) SELECT 'dense-' || value,${target.id},'health-failing','health-failing:prod','firing','private-dense',now() FROM generate_series(1,2001) AS value`);
    const platform = agentCallRow(null); await insertRow(database!, 'agent_calls', platform);
    await insertRow(database!, 'price_versions', { id: crypto.randomUUID(), profile_id: 'builtin:opencode', model: 'provider/model', input_micro: 1, cache_read_micro: null,
      cache_write_micro: null, output_micro: 2, effective_from: new Date().toISOString(), created_at: new Date().toISOString(), created_by: newResourceId(), note: 'platform' });
    const confirmed = await f.owner.inspect(target); expect(confirmed.complete).toBe(true);
    expect(confirmed.resources.map((row) => [row.kind, row.count])).toEqual([['alerts', 2002], ['agent_calls', 1], ['project_cost_visibility', 1]]);
    expect(JSON.stringify(confirmed)).not.toContain('private-');
    const restored = observabilityDeletionOwner(observabilityDeletionRepository(f.input));
    expect((await restored.run(f.context(confirmed, 'seal'))).kind).toBe('done');
    for (const phase of PROJECT_DELETION_PHASES.slice(1)) {
      const result = await f.owner.run(f.context(confirmed, phase)); expect(result.kind).toBe('done');
      if (phase === 'metadata') expect(await restored.run(f.context(confirmed, phase))).toEqual(result);
    }
    const counts = await contentCounts(database!);
    expect(counts).toMatchObject({ alerts: 1, agent_calls: 2, agent_call_models: 1, project_cost_visibility: 1, price_versions: 1 });
    expect(await raw(sql`SELECT id FROM observability.agent_calls WHERE id=${own.call.id}`)).toHaveLength(0);
    expect(await raw(sql`SELECT id FROM observability.agent_calls WHERE id IN (${other.call.id},${platform.id})`)).toHaveLength(2);
    expect(await raw(sql`SELECT call_id FROM observability.agent_call_models WHERE call_id=${other.call.id}`)).toHaveLength(1);
    expect((await f.owner.inspect(target)).resources).toEqual([]);
    expect(await f.owner.run(f.context(confirmed, 'verify'))).toEqual(await restored.run(f.context(confirmed, 'verify')));
    const recorder = createAgentCallRecorder({ store: drizzleAgentCallStore(database!.db), prices: drizzlePriceStore(database!.db) });
    await expect(recorder.accept(call(target.id))).rejects.toThrow();
    expect(await recorder.accept(call(otherId as ProjectId))).toBeString();
    await expect(drizzleAlertRepository(database!.db).fire({ id: newResourceId(), projectId: target.id, type: 'health-failing', key: 'health-failing:prod', state: 'firing', detail: 'late', firedAt: new Date() })).rejects.toThrow();
    await expect(drizzleAlertRepository(database!.db).resolve(target.id, 'health-failing:prod', new Date())).rejects.toThrow();
    await expect(drizzleCostVisibilityStore(database!.db).write({ projectId: target.id, visible: true, updatedAt: new Date(), updatedBy: newResourceId() })).rejects.toThrow();
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

  test('uses verified legacy project aliases and blocks a conflicting alias instead of declaring empty', async () => {
    const f = await setup(); await f.input.identities.bind('observability', 'project', ['old-project'], target.id);
    await seed(database!, 'old-project'); await seed(database!, otherId);
    const confirmed = await f.owner.inspect(target); expect(confirmed.resources.map((row) => row.count)).toEqual([1, 1, 1]);
    await stages(f, confirmed);
    expect((await contentCounts(database!)).agent_calls).toBe(1);
    const bad = observabilityDeletionOwner(observabilityDeletionRepository({ ...f.input, identities: { aliases: async () => [['old-project']], resolve: async () => otherId } }));
    await expect(bad.inspect(target)).rejects.toThrow('冲突');
  });

  test('seal waits for an in-flight project write while other projects continue, then rejects later writes', async () => {
    const f = await setup(), confirmed = await f.owner.inspect(target);
    let release!: () => void, entered!: () => void;
    const hold = new Promise<void>((resolve) => { release = resolve; }), started = new Promise<void>((resolve) => { entered = resolve; });
    const inFlight = database!.db.transaction(async (tx) => { await tx.execute(sql`SELECT observability.admit_project(${target.id})`); entered(); await hold; });
    await started;
    let settled = false;
    const sealing = f.owner.run(f.context(confirmed, 'seal')).then((result) => { settled = true; return result; });
    const recorder = createAgentCallRecorder({ store: drizzleAgentCallStore(database!.db), prices: drizzlePriceStore(database!.db) });
    expect(await recorder.accept(call(otherId as ProjectId))).toBeString();
    expect(settled).toBe(false);
    release(); await inFlight;
    expect((await sealing).kind).toBe('done');
    await expect(recorder.accept(call(target.id))).rejects.toThrow();
  });

  test('the wired internal owner works with a one-connection directory and does not create a public deletion endpoint', async () => {
    const f = await setup(), connection = connectDatabase(database!.url, { max: 1 });
    try {
      const identities = resourceIdentityDirectory(connection.db, () => [observabilityMigrations]);
      const module = createObservabilityModule({ db: connection.db, k8s: createFakeK8sClient(), isAdmin: async () => true,
        authorizer: { authorize: async () => undefined }, services: { resolveServiceOfProject: async () => undefined }, slots: { slotRoles: async () => undefined },
        traces: { environments: { traceKeys: async () => [], activeTraceIds: async () => [], list: async () => [] }, deliveries: { traceKeys: async () => [], activeTraceIds: async () => [], list: async () => [] },
          businessTasks: { list: async () => [] }, sessions: { summarize: async () => [], events: async () => [] } },
        deletion: { identities, assertGrant: f.input.assertGrant },
      });
      expect(module.api.deletionOwner?.participant).toBe('observability');
      const app = createApp({ name: 'observation-cleanup-internal' });
      for (const router of module.http) app.route('/', router);
      expect((await app.request('/v1/admin/projects/' + target.id + '/deletion-plan', { method: 'POST' })).status).toBe(404);
      const owner = module.api.deletionOwner!, confirmed = await owner.inspect(target); expect(confirmed.complete).toBe(true); expect(confirmed.resources).toEqual([]);
      for (const phase of PROJECT_DELETION_PHASES) expect((await owner.run(f.context(confirmed, phase))).kind).toBe('done');
    } finally { await connection.close(); }
  });

  test('lease recovery preserves the original seal and requires the current grant generation', async () => {
    const f = await setup(); await seed(database!, target.id); await seed(database!, otherId);
    let generation = 3;
    const input = { ...f.input, assertGrant: async (context: Parameters<typeof f.input.assertGrant>[0]) => { await f.input.assertGrant(context); if (context.generation !== generation) throw Error('当前租约世代已失效'); } };
    const repository = observabilityDeletionRepository(input), owner = observabilityDeletionOwner(repository);
    const confirmed = await owner.inspect(target); expect((await owner.run(f.context(confirmed, 'seal', 3))).kind).toBe('done');
    const sealed = (await raw(sql`SELECT generation,revision,original FROM observability.deletion_fences WHERE project_id=${target.id}`))[0]!;
    generation = 7;
    await expect(owner.run(f.context(confirmed, 'stop', 3))).rejects.toThrow('世代');
    generation = 1; await expect(owner.run(f.context(confirmed, 'stop', 1))).rejects.toThrow('世代');
    generation = 7;
    expect((await owner.run(f.context(confirmed, 'stop', 7))).kind).toBe('done');
    for (const phase of PROJECT_DELETION_PHASES.slice(2)) { generation++; expect((await owner.run(f.context(confirmed, phase, generation))).kind).toBe('done'); }
    expect((await raw(sql`SELECT generation,revision,original FROM observability.deletion_fences WHERE project_id=${target.id}`))[0]).toEqual(sealed);
    expect((await contentCounts(database!)).agent_calls).toBe(1);
    const replay = await owner.run(f.context(confirmed, 'metadata', generation)); generation++;
    expect(await owner.run(f.context(confirmed, 'metadata', generation))).toEqual(replay);
    expect(jsonHash(replay)).toBe(jsonHash(await owner.run(f.context(confirmed, 'metadata', generation))));
  });
});
