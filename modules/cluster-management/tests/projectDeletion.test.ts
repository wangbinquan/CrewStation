import { afterEach, describe, expect, test } from 'bun:test';
import { sql, type SQL } from 'drizzle-orm';
import { ProjectDeletionTargetSchema, PROJECT_DELETION_PHASES } from '@crewstation/contracts';
import type { ClusterInspection, ClusterOperation, ProjectDeletionContext, ProjectDeletionInventory } from '@crewstation/contracts';
import { jsonHash, newResourceId } from '@crewstation/kernel';
import { runMigrations } from '@crewstation/persistence';
import { claimJobs, queueMigrations } from '@crewstation/queue';
import { createTestDatabase, testDatabaseAvailable } from '@crewstation/testkit';
import type { TestDatabase } from '@crewstation/testkit';
import { clusterManagementMigrations } from '../index';
import { clusterManagementDeletionOwner } from '../application/projectDeletion';
import { clusterDeletionRepository, clusterProjectAdmission } from '../adapters/persistence/projectDeletion';
import { drizzleClusterRepository } from '../adapters/persistence/drizzleRepository';
import { drizzleMetricsRepository } from '../adapters/persistence/metricsRepository';
import { snapshots } from '../adapters/persistence/tables';
import { observeMetrics } from '../application/observeMetrics';
import { METRICS_JOB, STORAGE_JOB } from '../ports/metrics';
import { metricsFixture } from './metricsFixture';
import { admin, facts } from './inventoryFixture';

const available = await testDatabaseAvailable();
const target = ProjectDeletionTargetSchema.parse({ id: facts.projects[0]!.projectId, slug: 'demo', name: 'Demo', namespace: 'cs-demo', serviceId: facts.projects[0]!.serviceId,
  kind: 'DigitalWorker', state: 'active', revision: '1', prodHost: 'demo.cs.localhost', previewHost: 'preview.demo.cs.localhost', serviceHost: 'demo' });
const otherId = '01a0bf5d-8f4b-7178-82e1-9a99060b1193';
const originalProcess = { podUid: crypto.randomUUID(), containerId: 'containerd://' + 'a'.repeat(64), nodeUid: crypto.randomUUID(), nodeName: 'fixture-node' };
let tdb: TestDatabase | undefined;
afterEach(async () => { const owned = tdb; tdb = undefined; await owned?.drop(); }, 15_000);
const raw = async (statement: SQL) => await tdb!.db.execute(statement);
const identities = {
  aliases: async (kind: string, id: string) => kind === 'project' && id === target.id ? [['demo']] : kind === 'service' && id === target.serviceId ? [['svc-demo']] : [],
  resolve: async (kind: string, keys: readonly string[]) => kind === 'project' && keys[0] === 'demo' ? target.id : kind === 'service' && keys[0] === 'svc-demo' ? target.serviceId : undefined,
};
async function fixture() {
  tdb = await createTestDatabase([queueMigrations, clusterManagementMigrations]);
  const f = metricsFixture(), repository = drizzleClusterRepository(tdb.db), operationId = newResourceId();
  f.inventory.facts = structuredClone(f.inventory.facts); await repository.saveSnapshot(f.inventory);
  const input = { db: tdb.db, identities, assertGrant: async (context: ProjectDeletionContext) => { if (context.operationId !== operationId) throw new Error('wrong operation'); },
    processes: { protectCurrent: async () => originalProcess, sweep: async () => undefined } };
  const deletion = clusterDeletionRepository(input), owner = clusterManagementDeletionOwner(deletion), admission = clusterProjectAdmission(input);
  const context = (confirmed: ProjectDeletionInventory, phase: ProjectDeletionContext['phase'], generation = 1): ProjectDeletionContext => ({ operationId, generation, target, confirmed, phase });
  const own = f.inventory.resources.find((resource) => resource.ownership.scope === 'project')!;
  const inspection: ClusterInspection = { inspectionId: newResourceId(), expiresAt: new Date(Date.now() + 300_000).toISOString(), target: own, request: { action: 'delete' },
    capability: { action: 'delete', enabled: true, reason: 'fixture', executionRoute: 'kubernetes', impactSummary: [] }, related: [] };
  const operation: ClusterOperation = { operationId: newResourceId(), inspectionId: inspection.inspectionId, idempotencyKey: newResourceId(), actorId: admin.userId, action: 'delete', target: own,
    params: { action: 'delete' }, phase: 'succeeded', createdAt: f.inventory.finishedAt, updatedAt: f.inventory.finishedAt, durationMs: 0, traceId: crypto.randomUUID(), httpStatus: 200, reason: 'fixture' };
  return { f, repository, deletion, owner, admission, context, inspection, operation, input };
}
async function stages(f: Awaited<ReturnType<typeof fixture>>, confirmed: ProjectDeletionInventory, generation = 1) {
  for (const phase of PROJECT_DELETION_PHASES) {
    const result = await f.owner.run(f.context(confirmed, phase, generation)); expect(result.kind).toBe('done');
    if (phase === 'metadata') expect(await f.owner.run(f.context(confirmed, phase, generation))).toEqual(result);
  }
}

describe.skipIf(!available)('cluster project content permanent cleanup', () => {
  test('clears every current and legacy shared row, metrics and operations while preserving another project and rejecting late writes', async () => {
    const f = await fixture(), metrics = drizzleMetricsRepository(tdb!.db);
    await f.repository.saveInspection({ actorId: admin.userId, inspection: f.inspection }); await f.repository.accept(f.operation, 'original');
    const mixed = structuredClone(f.f.inventory), own = mixed.resources.find((resource) => resource.ownership.scope === 'project')!;
    const foreign = { ...structuredClone(own), uid: 'other-pod', resourceId: newResourceId(), name: 'other-private-name', namespace: 'cs-other', references: [own.namespace + '/' + own.kind + '/' + own.name, 'cs-other/Secret/kept'], ownership: { scope: 'project' as const, projectId: otherId, projectName: 'Other', slug: 'other', projectKind: 'DigitalWorker', archived: false } };
    mixed.resources.push(foreign); mixed.facts.projects.push({ ...mixed.facts.projects[0]!, projectId: otherId, namespace: 'cs-other', name: 'Other', slug: 'other', serviceId: newResourceId() });
    const legacy = structuredClone(mixed); legacy.facts.projects[0]!.projectId = 'demo';
    const foreignInspection = { ...f.inspection, inspectionId: newResourceId(), target: foreign, related: [{ uid: own.uid, kind: own.kind, name: own.name }] };
    const foreignOperation = { ...f.operation, operationId: newResourceId(), inspectionId: foreignInspection.inspectionId, idempotencyKey: newResourceId(), target: foreign, after: foreign };
    await f.repository.saveInspection({ actorId: admin.userId, inspection: foreignInspection }); await f.repository.accept(foreignOperation, 'foreign');
    for (const resource of legacy.resources) if (resource.ownership.scope === 'project' && resource.ownership.projectId === target.id) resource.ownership.projectId = 'demo';
    await tdb!.db.insert(snapshots).values(Array.from({ length: 501 }, () => { const id = newResourceId(); return { id, body: { ...mixed, id }, createdAt: new Date(mixed.finishedAt) }; }));
    await tdb!.db.execute(sql`UPDATE cluster_management.snapshots SET legacy_body=${JSON.stringify(legacy)}::jsonb,identity_provenance=${JSON.stringify({ originalHash: jsonHash(legacy) })}::jsonb WHERE id=${f.f.inventory.id}`);
    f.f.deps.inventory = f.repository; f.f.deps.repository = metrics; await metrics.schedule('metrics');
    const job = (await claimJobs(tdb!.db, [METRICS_JOB], 'cleanup-fixture', 60, 1))[0]!, ticket = { requestId: (job.payload as { requestId: string }).requestId, fence: job.fencingToken };
    await metrics.claim('metrics', ticket); await observeMetrics(f.f.deps, ticket, new AbortController().signal);
    const originalObservation = (await metrics.latest())!;
    await metrics.schedule('storage'); const storageJob = (await claimJobs(tdb!.db, [STORAGE_JOB], 'cleanup-fixture', 60, 1))[0]!;
    const storageTicket = { requestId: (storageJob.payload as { requestId: string }).requestId, fence: storageJob.fencingToken }; await metrics.claim('storage', storageTicket);
    const samples = [{ uid: f.f.pvc.metadata.uid!, volumeUid: f.f.volume.metadata.uid!, metric: { unit: 'bytes' as const, state: 'fresh' as const, value: '4096', source: 'fixture' } }];
    await metrics.saveStorage(samples, f.f.inventory.finishedAt, storageTicket);
    const confirmed = await f.owner.inspect(target); expect(confirmed.complete).toBe(true); expect(confirmed.resources.length).toBeGreaterThan(500);
    await stages(f, confirmed);
    const current = await f.owner.inspect(target); expect(current.resources).toEqual([]); expect(current.complete).toBe(true);
    const rows = await tdb!.db.execute<{ body: typeof mixed; legacy_body: typeof mixed | null; identity_provenance: unknown }>(sql`SELECT body,legacy_body,identity_provenance FROM cluster_management.snapshots`);
    expect(rows).toHaveLength(502); expect(rows.flatMap((row) => row.body.resources).filter((resource) => resource.uid === foreign.uid)).toHaveLength(501);
    expect(rows.find((row) => row.legacy_body)?.legacy_body?.resources.find((resource) => resource.uid === foreign.uid)).toEqual({ ...foreign, references: ['cs-other/Secret/kept'] });
    expect(rows.find((row) => row.legacy_body)?.identity_provenance).toBeNull(); expect(JSON.stringify(rows)).not.toContain(target.id); expect(JSON.stringify(rows)).not.toContain('"projectId":"demo"');
    expect(await f.repository.operation(f.operation.operationId)).toBeUndefined(); expect(await metrics.storage()).toEqual([]);
    expect((await f.repository.inspection(foreignInspection.inspectionId))?.inspection.target.references).toEqual(['cs-other/Secret/kept']);
    expect((await f.repository.inspection(foreignInspection.inspectionId))?.inspection.related).toEqual([]);
    expect((await f.repository.operation(foreignOperation.operationId))?.after?.references).toEqual(['cs-other/Secret/kept']);
    await expect(raw(sql`UPDATE cluster_management.operations SET body=${JSON.stringify(foreignOperation)}::jsonb WHERE id=${foreignOperation.operationId}`)).rejects.toThrow();
    const latest = (await metrics.latest())!; expect(latest.nodes.map((node) => node.metrics)).toEqual(originalObservation.nodes.map((node) => node.metrics)); expect(latest.capacity.metrics).toEqual(originalObservation.capacity.metrics);
    expect(latest.nodes.flatMap((node) => node.managedPods ?? []).some((pod) => pod.namespace === target.namespace)).toBe(false);
    await f.repository.saveSnapshot({ ...mixed, id: newResourceId() }); expect((await f.repository.latest())!.resources.some((resource) => resource.uid === own.uid)).toBe(false);
    f.f.advance(); await metrics.save({ ...originalObservation, id: newResourceId(), at: f.f.deps.clock.now().toISOString() }, ticket);
    expect((await metrics.latest())!.usages.some((usage) => usage.projectId === target.id)).toBe(false);
    await metrics.saveStorage(samples, f.f.deps.clock.now().toISOString(), storageTicket); expect(await metrics.storage()).toEqual([]);
    const unresolved = structuredClone(originalObservation); unresolved.nodes = [];
    unresolved.counters = {}; unresolved.storageTargets = []; unresolved.identities = [];
    for (const usage of unresolved.usages) if (usage.projectId === target.id) { delete usage.projectId; usage.scope = 'unresolved'; }
    await metrics.save({ ...unresolved, id: newResourceId(), at: new Date(f.f.deps.clock.now().getTime() + 1).toISOString() }, ticket);
    expect((await metrics.latest())!.usages.filter((usage) => usage.namespace === target.namespace)).toEqual([]);
    await expect(raw(sql`UPDATE cluster_management.metric_observations SET body=${JSON.stringify(unresolved)}::jsonb WHERE id=${(await metrics.latest())!.id}`)).rejects.toThrow();
    await expect(f.repository.saveInspection({ actorId: admin.userId, inspection: { ...f.inspection, inspectionId: newResourceId() } })).rejects.toThrow('永久清理');
    await expect(raw(sql`UPDATE cluster_management.snapshots SET body=${JSON.stringify(mixed)}::jsonb WHERE id=${mixed.id}`)).rejects.toThrow();
    expect(await f.owner.run(f.context(confirmed, 'verify'))).toEqual(await f.owner.run(f.context(confirmed, 'verify')));
  }, 20_000);

  test('preserves actual current ownership for another project sharing historical UIDs, name references and metric series', async () => {
    const f = await fixture(), metrics = drizzleMetricsRepository(tdb!.db), transferred = structuredClone(f.f.inventory);
    transferred.facts.projects = transferred.facts.projects.map((project) => ({ ...project, projectId: otherId, name: 'Other', slug: 'other', serviceId: newResourceId() }));
    for (const resource of transferred.resources) if (resource.ownership.scope === 'project') resource.ownership = { ...resource.ownership, projectId: otherId, projectName: 'Other', slug: 'other' };
    await f.repository.saveSnapshot({ ...transferred, id: newResourceId() });
    f.f.deps.inventory = f.repository; f.f.deps.repository = metrics; await metrics.schedule('metrics');
    const job = (await claimJobs(tdb!.db, [METRICS_JOB], 'foreign-fixture', 60, 1))[0]!, ticket = { requestId: (job.payload as { requestId: string }).requestId, fence: job.fencingToken };
    await metrics.claim('metrics', ticket); await observeMetrics(f.f.deps, ticket, new AbortController().signal);
    const observation = (await metrics.latest())!, uid = f.f.pvc.metadata.uid!;
    await metrics.schedule('storage'); const storageJob = (await claimJobs(tdb!.db, [STORAGE_JOB], 'foreign-fixture', 60, 1))[0]!;
    const storageTicket = { requestId: (storageJob.payload as { requestId: string }).requestId, fence: storageJob.fencingToken }; await metrics.claim('storage', storageTicket);
    const samples = [{ uid, volumeUid: f.f.volume.metadata.uid!, metric: { unit: 'bytes' as const, state: 'fresh' as const, value: '8192', source: 'fixture' } }];
    await metrics.saveStorage(samples, f.f.inventory.finishedAt, storageTicket);
    const confirmed = await f.owner.inspect(target); expect(confirmed.complete).toBe(true); await stages(f, confirmed);
    expect((await f.repository.latest())!.resources).toEqual(transferred.resources);
    expect((await metrics.latest())!.usages).toEqual(observation.usages); expect((await metrics.latest())!.nodes).toEqual(observation.nodes);
    expect(await metrics.storage()).toEqual(samples);
    f.f.advance(); await metrics.save({ ...observation, id: newResourceId(), at: f.f.deps.clock.now().toISOString() }, ticket);
    await metrics.saveStorage(samples, f.f.deps.clock.now().toISOString(), storageTicket); expect(await metrics.storage()).toEqual(samples);
    expect((await f.owner.inspect(target)).resources).toEqual([]);
  });

  test('failed seal remains closed and false until a new approved generation rechecks the current content', async () => {
    const f = await fixture(), confirmed = await f.owner.inspect(target);
    await f.repository.saveInspection({ actorId: admin.userId, inspection: f.inspection });
    expect((await f.owner.run(f.context(confirmed, 'seal'))).kind).toBe('blocked'); expect((await f.owner.run(f.context(confirmed, 'seal'))).kind).toBe('blocked');
    await expect(f.owner.run(f.context(confirmed, 'stop'))).rejects.toThrow('确认');
    const current = await f.owner.inspect(target); await stages(f, current, 2);
    await expect(f.owner.run(f.context(current, 'verify', 1))).rejects.toThrow('世代');
    await expect(f.owner.run({ ...f.context(current, 'verify', 2), operationId: newResourceId() })).rejects.toThrow('wrong operation');
    await expect(f.owner.run({ ...f.context(current, 'verify', 2), target: { ...target, namespace: 'cs-replacement' } })).rejects.toThrow('原项目');
    await expect(raw(sql`UPDATE cluster_management.deletion_fences SET original='{}'::jsonb WHERE project_id=${target.id}`)).rejects.toThrow();
  });

  test('tracks actual callbacks, protects other projects and requires an exit before cleanup can proceed', async () => {
    const f = await fixture(); await f.repository.accept({ ...f.operation, phase: 'queued' }, 'callback');
    let release!: () => void, started!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; }), ready = new Promise<void>((resolve) => { started = resolve; });
    const work = f.admission.withAdmission(target.id, f.operation.operationId, async () => { started(); await gate; f.admission.assertActive(); }); await ready;
    try {
    const [row] = await tdb!.db.execute<{ state: string; process: unknown }>(sql`SELECT state,process FROM cluster_management.deletion_work WHERE project_id=${target.id}`);
    expect(row).toEqual({ state: 'running', process: originalProcess });
    await expect(raw(sql`UPDATE cluster_management.deletion_work SET state='exited',exit_digest=${'b'.repeat(64)} WHERE project_id=${target.id}`)).rejects.toThrow();
    const confirmed = await f.owner.inspect(target); expect(confirmed.complete).toBe(true);
    const pending = f.owner.run(f.context(confirmed, 'seal'));
    const other = structuredClone(f.f.inventory); other.id = newResourceId(); for (const resource of other.resources) if (resource.ownership.scope === 'project') resource.ownership.projectId = otherId;
    other.facts.projects = [{ ...facts.projects[0]!, projectId: otherId, namespace: 'cs-other', serviceId: newResourceId() }]; await f.repository.saveSnapshot(other);
    release(); await work;
    // Callback exit changed metadata after confirmation. A new generation is required, not an automatic success.
    expect((await pending).kind).toBe('blocked'); const current = await f.owner.inspect(target); await stages(f, current, 2);
    expect((await f.repository.snapshot(other.id))!.facts.projects[0]?.projectId).toBe(otherId);
    } finally { release(); await work.catch(() => undefined); }
  });

  test('a long original callback returns waiting without sealing or blocking other projects', async () => {
    const f = await fixture(); await f.repository.accept({ ...f.operation, phase: 'queued' }, 'long-callback');
    let release!: () => void, started!: () => void;
    const held = new Promise<void>((resolve) => { release = resolve; }), ready = new Promise<void>((resolve) => { started = resolve; });
    const work = f.admission.withAdmission(target.id, f.operation.operationId, async () => { started(); await held; }); await ready;
    try {
      const confirmed = await f.owner.inspect(target), pending = f.owner.run(f.context(confirmed, 'seal'));
      const other = structuredClone(f.f.inventory); other.id = newResourceId(); other.facts.projects = [];
      other.resources = other.resources.filter((resource) => resource.ownership.scope !== 'project');
      await f.repository.saveSnapshot(other); expect(await f.repository.snapshot(other.id)).toBeDefined();
      expect((await pending).kind).toBe('waiting');
      expect(await raw(sql`SELECT project_id FROM cluster_management.deletion_fences WHERE project_id=${target.id}`)).toHaveLength(0);
      expect((await raw(sql`SELECT state FROM cluster_management.deletion_work WHERE project_id=${target.id}`))[0]?.['state']).toBe('running');
    } finally { release(); await work; }
    await stages(f, await f.owner.inspect(target));
  }, 45_000);

  test('a lost protected backend leaves the original callback pending and prevents a late external mutation', async () => {
    const f = await fixture(); await f.repository.accept({ ...f.operation, phase: 'queued' }, 'disconnect');
    let release!: () => void, started!: () => void, exited!: () => void, mutations = 0;
    const gate = new Promise<void>((resolve) => { release = resolve; }), ready = new Promise<void>((resolve) => { started = resolve; }), finished = new Promise<void>((resolve) => { exited = resolve; });
    const work = f.admission.withAdmission(target.id, f.operation.operationId, async () => { started(); try { await gate; f.admission.assertActive(); mutations++; } finally { exited(); } }); await ready;
    const outcome = work.then(() => 'unexpected-success', () => 'disconnected');
    try {
    const [row] = await tdb!.db.execute<{ backend_pid: number }>(sql`SELECT backend_pid FROM cluster_management.deletion_work WHERE project_id=${target.id}`);
    await tdb!.db.execute(sql`SELECT pg_terminate_backend(${row!.backend_pid})`); expect(await outcome).toBe('disconnected');
    const confirmed = await f.owner.inspect(target); expect((await f.owner.run(f.context(confirmed, 'seal'))).kind).toBe('done');
    expect((await f.owner.run(f.context(confirmed, 'stop'))).kind).toBe('waiting');
    release(); await finished; expect(mutations).toBe(0);
    // Wait for its actual finally journal, not for a vanished connection or a queue lease.
    const deadline = Date.now() + 2000;
    while ((await tdb!.db.execute<{ state: string }>(sql`SELECT state FROM cluster_management.deletion_work WHERE project_id=${target.id}`))[0]?.state !== 'exited') {
      if (Date.now() > deadline) throw new Error('actual callback finally did not finish'); await Bun.sleep(5);
    }
    expect((await f.owner.run(f.context(confirmed, 'stop'))).kind).toBe('done');
    } finally { release(); await outcome; await finished; }
  }, 15_000);

  test('upgrade keeps unknown old nonterminal operation origins explicit instead of manufacturing a process or exit proof', async () => {
    const f = await fixture(), previous = tdb; tdb = undefined; await previous!.drop();
    tdb = await createTestDatabase([queueMigrations, { ...clusterManagementMigrations, files: clusterManagementMigrations.files.filter((file) => !file.name.startsWith('0007_')) }]);
    await raw(sql`INSERT INTO cluster_management.operations(id,actor_id,idempotency_key,request_hash,created_at,body)
      VALUES(${f.operation.operationId},${admin.userId},${f.operation.idempotencyKey},'old',now(),${JSON.stringify({ ...f.operation, phase: 'executing' })}::jsonb)`);
    await runMigrations(tdb.db, [queueMigrations, clusterManagementMigrations]);
    const deletion = clusterDeletionRepository({ ...f.input, db: tdb.db }), owner = clusterManagementDeletionOwner(deletion), repository = drizzleClusterRepository(tdb.db);
    const current = await owner.inspect(target); expect(current.complete).toBe(false); expect(current.blockers[0]?.code).toBe('cluster-callback-origin-unknown');
    await expect(owner.run(f.context({ ...current, complete: true, blockers: [] }, 'seal'))).resolves.toMatchObject({ kind: 'blocked' });
    expect(await repository.operation(f.operation.operationId)).toBeDefined();
    await expect(raw(sql`DELETE FROM cluster_management.deletion_legacy_operations WHERE operation_id=${f.operation.operationId}`)).rejects.toThrow();
    await expect(raw(sql`INSERT INTO cluster_management.deletion_work(id,project_id,operation_id,backend_pid,callback_pid,callback_started_at)
      VALUES(${newResourceId()},${target.id},${f.operation.operationId},1,1,now())`)).rejects.toThrow();
  });

  test('unknown content columns and conflicting old identifier sources fail closed', async () => {
    const f = await fixture(); await tdb!.db.execute(sql`ALTER TABLE cluster_management.snapshots ADD COLUMN private_project_body jsonb`);
    await expect(f.owner.inspect(target)).rejects.toThrow('未登记');
    await tdb!.db.execute(sql`ALTER TABLE cluster_management.snapshots DROP COLUMN private_project_body`);
    const wrong = clusterManagementDeletionOwner(clusterDeletionRepository({ ...f.input, identities: { ...identities, resolve: async () => otherId } }));
    await expect(wrong.inspect(target)).rejects.toThrow('原身份冲突');
    await expect(clusterManagementDeletionOwner(clusterDeletionRepository({ db: tdb!.db })).inspect(target)).rejects.toThrow('未装配');
    // Re-applying an already installed migration does not erase its tombstones or callback facts.
    await runMigrations(tdb!.db, [queueMigrations, clusterManagementMigrations]); expect((await f.owner.inspect(target)).complete).toBe(true);
  });
  test('ambiguous historical ownership stays blocked instead of silently dropping unresolved versions', async () => {
    const f = await fixture(), own = f.f.inventory.resources.find((resource) => resource.ownership.scope === 'project')!;
    const history = { resourceId: own.resourceId, uid: own.uid, kind: own.kind, namespace: own.namespace, name: own.name, scope: 'project', projectId: target.id,
      firstSeen: f.f.inventory.finishedAt, lastSeen: f.f.inventory.finishedAt, deleted: false, versions: [
        { from: f.f.inventory.finishedAt, name: own.name, namespace: own.namespace, scope: 'unresolved' },
        { from: f.f.inventory.finishedAt, name: 'other-pod', namespace: 'cs-other', scope: 'project', projectId: otherId }] };
    await raw(sql`INSERT INTO cluster_management.metric_history(id,last_seen,body) VALUES(${own.resourceId},now(),${JSON.stringify(history)}::jsonb)`);
    const current = await f.owner.inspect(target); expect(current.complete).toBe(false); expect(current.blockers[0]?.code).toBe('cluster-history-owner-ambiguous');
    expect((await f.owner.run(f.context({ ...current, complete: true, blockers: [] }, 'seal'))).kind).toBe('blocked');
    expect((await raw(sql`SELECT body FROM cluster_management.metric_history WHERE id=${own.resourceId}`))[0]?.['body']).toEqual(history);
  });
  test('an owned legacy backup cannot erase another project current row, and the inverse ownership conflict blocks cleanup', async () => {
    const f = await fixture(), foreign = { ...f.inspection, inspectionId: newResourceId(), target: { ...f.inspection.target, resourceId: newResourceId(), uid: 'foreign-inspection', namespace: 'cs-other', references: [],
      ownership: { scope: 'project' as const, projectId: otherId, projectName: 'Other', slug: 'other', projectKind: 'DigitalWorker', archived: false } } };
    await f.repository.saveInspection({ actorId: admin.userId, inspection: foreign });
    await raw(sql`UPDATE cluster_management.inspections SET legacy_body=${JSON.stringify(f.inspection)}::jsonb,identity_provenance='{}'::jsonb WHERE id=${foreign.inspectionId}`);
    const confirmed = await f.owner.inspect(target); expect(confirmed.complete).toBe(true); await stages(f, confirmed);
    expect((await f.repository.inspection(foreign.inspectionId))?.inspection).toEqual(foreign);
    expect((await raw(sql`SELECT legacy_body,identity_provenance FROM cluster_management.inspections WHERE id=${foreign.inspectionId}`))[0]).toEqual({ legacy_body: null, identity_provenance: null });
    const originalDb = tdb; tdb = undefined; await originalDb!.drop();
    const inverse = await fixture(); await inverse.repository.saveInspection({ actorId: admin.userId, inspection: inverse.inspection });
    await raw(sql`UPDATE cluster_management.inspections SET legacy_body=${JSON.stringify(foreign)}::jsonb WHERE id=${inverse.inspection.inspectionId}`);
    const blocked = await inverse.owner.inspect(target); expect(blocked.complete).toBe(false); expect(blocked.blockers[0]?.code).toBe('cluster-current-legacy-owner-conflict');
    expect((await inverse.owner.run(inverse.context({ ...blocked, complete: true, blockers: [] }, 'seal'))).kind).toBe('blocked');
    expect((await raw(sql`SELECT legacy_body FROM cluster_management.inspections WHERE id=${inverse.inspection.inspectionId}`))[0]?.['legacy_body']).toEqual(foreign);
  });
  test('an unidentified project reference inside another project domain detail blocks a false empty inventory', async () => {
    const f = await fixture(), foreign = { ...f.inspection, target: { ...f.inspection.target, resourceId: newResourceId(), uid: 'foreign-domain', namespace: 'cs-other', references: [],
      ownership: { scope: 'project' as const, projectId: otherId, projectName: 'Other', slug: 'other', projectKind: 'DigitalWorker', archived: false } }, domain: { projectId: target.id, payload: 'unidentified-owned-content' } };
    await f.repository.saveInspection({ actorId: admin.userId, inspection: foreign });
    const current = await f.owner.inspect(target); expect(current.complete).toBe(false); expect(current.blockers[0]?.code).toBe('cluster-content-reference-unknown');
    expect((await f.owner.run(f.context({ ...current, complete: true, blockers: [] }, 'seal'))).kind).toBe('blocked');
    expect((await f.repository.inspection(foreign.inspectionId))?.inspection.domain).toEqual(foreign.domain);
  });
});
