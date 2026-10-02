import { afterEach, describe, expect, test } from 'bun:test';
import { noopLogger } from '@crewstation/kernel';
import { testDatabaseAvailable } from '@crewstation/testkit';
import { sql } from 'drizzle-orm';
import { kubernetesTaskCluster } from '../adapters/k8s/taskCluster';
import type { UnitOfWork } from '../ports/unitOfWork';
import { recordPodInstance } from '../application/createEnvironment';
import { recordInitialPodFailure } from '../application/environmentCreation/initialPodResult';
import { readDevelopmentParentEnding } from '../domain/development/parentEnding';
import type { InitialPodResultFixture } from './initialPodResultFixture';
import { initialPodResultFixture } from './initialPodResultFixture';
import { developmentParentPhysicalFixture } from './developmentParentPhysicalFixture';
import { acceptParentRebuild, stopParentForRebuild } from './developmentParentRebuildFixture';

const available = await testDatabaseAvailable();
describe.skipIf(!available)('initial Pod results preserve original identity (real PG)', () => {
  let f: InitialPodResultFixture | undefined;
  afterEach(async () => { await f?.close(); f = undefined; });
  const setup = async () => { f = await initialPodResultFixture(); return f; };

  for (const lostAck of [false, true]) test('connected Runner survives ' + (lostAck ? 'lost' : 'late') + ' original ACK', async () => {
    const t = await setup(), pending = await t.start();
    const current = await t.connect(pending.original), before = await t.snapshot(), error = new Error('original Pod ACK lost');
    expect(current).toMatchObject({ state: 'running', connected: true, startup: { state: 'ready' } });
    pending.finish(lostAck ? error : undefined);
    const result = await pending.settled;
    expect(result.error).toBe(lostAck ? error : undefined);
    expect(await t.load(current.id)).toEqual(current);
    expect(await t.snapshot()).toEqual(before);
  }, 15000);

  for (const lostAck of [false, true]) test('actual protected child and parent ending remain unchanged on ' + (lostAck ? 'lost' : 'late') + ' ACK', async () => {
    const t = await setup(), pending = await t.start();
    await t.connect(pending.original); const child = await t.seal(pending.original), current = await t.load(pending.original.id);
    const pointer = readDevelopmentParentEnding(current)!;
    expect(pointer.phase).toBe('admission-sealed');
    const ending = await t.uow.read.parentEnding!.endings.get(pointer.endingId);
    expect(ending?.memberCount).toBe(1); expect((await t.load(child.id)).native?.state).toBe('queued');
    const before = await t.snapshot(), error = new Error('original Pod ACK lost after sealing');
    pending.finish(lostAck ? error : undefined);
    expect((await pending.settled).error).toBe(lostAck ? error : undefined);
    expect(await t.snapshot()).toEqual(before);
    expect(await t.uow.read.parentEnding!.endings.get(pointer.endingId)).toEqual(ending);
  }, 15000);

  test('the unchanged unconnected legacy failure preserves the original error and existing failure/refund semantics', async () => {
    const t = await setup(), pending = await t.start(), error = new Error('original cluster failure');
    expect(await t.resources.api.occupancy(t.projectId)).toBe(1);
    pending.finish(error); expect((await pending.settled).error).toBe(error);
    expect(await t.load(pending.original.id)).toMatchObject({ state: 'failed', connected: false, startup: { state: 'failed' }, message: error.message });
    expect(await t.resources.api.occupancy(t.projectId)).toBe(0);
    // This is the legacy unbound failure semantic, not physical proof that createPod never executed.
  }, 15000);

  for (const kind of ['dev-session', 'business', 'profile-test'] as const) test(kind + ': SQL NULL render/native permits the normal original UID ACK', async () => {
    const t = await setup(), pending = await t.start(kind);
    const raw = (await t.tdb.db.execute(sql`SELECT render IS NULL AS render_absent, native IS NULL AS native_absent FROM task_runtime.environments WHERE id=${pending.original.id}`))[0]!;
    expect(raw).toMatchObject({ render_absent: true, native_absent: true });
    pending.finish(); expect((await pending.settled).error).toBeUndefined();
    expect(await t.load(pending.original.id)).toMatchObject({ state: 'creating', startup: { stages: expect.arrayContaining([expect.objectContaining({ kind: 'queue', state: 'succeeded' })]) } });
    expect((await t.load(pending.original.id)).podUid).toBeTruthy();
  }, 15000);

  test('actual persistent business pause/resume binds its new Pod, while an old result cannot replace it', async () => {
    const t = await setup(), first = await t.start('business', 'persistent');
    first.finish(); await first.settled; const ready = await t.connect(first.original);
    await t.runtime.api.pauseEnvironment(ready.id);
    const resumed = await t.start('business', 'persistent', ready.id);
    resumed.finish(); expect((await resumed.settled).error).toBeUndefined();
    const current = await t.load(ready.id); expect(current.podUid).toBeTruthy(); expect(current.podUid).not.toBe(ready.podUid);
    const before = await t.snapshot();
    await recordPodInstance(t.deps, first.original, ready.podUid);
    await recordInitialPodFailure(t.deps, first.original, 'old delayed error');
    expect(await t.snapshot()).toEqual(before);
  }, 15000);

  const invalid = [null, false, 17, '{"image":"looks-like-an-object"}', []] as const;
  for (const field of ['render', 'native'] as const) for (const value of invalid) for (const lostAck of [false, true]) {
    test(field + ' JSONB ' + JSON.stringify(value) + ': ' + (lostAck ? 'failure' : 'ACK') + ' preserves raw presence/type and all persistent state', async () => {
      const t = await setup(), pending = await t.start();
      const column = sql.identifier(field);
      await t.tdb.db.execute(sql`UPDATE task_runtime.environments SET ${column}=${JSON.stringify(value)}::jsonb WHERE id=${pending.original.id}`);
      const view = await t.uow.read.environments.getMaintenanceView!(pending.original.id);
      expect(view?.status).toBe('malformed');
      const before = await t.snapshot(), error = new Error('original cluster error with malformed source');
      pending.finish(lostAck ? error : undefined);
      expect((await pending.settled).error).toBe(lostAck ? error : undefined);
      expect(await t.snapshot()).toEqual(before);
      expect(await t.resources.api.occupancy(t.projectId)).toBe(1);
    }, 15000);
  }

  for (const marker of [null, false, { version: 1 }, { phase: 'complete' }]) test('explicit invalid parent marker ' + JSON.stringify(marker) + ' admits no result write', async () => {
    const t = await setup(), pending = await t.start();
    // Deliberately invalid input; no marker is presented as an actual ending/completion proof.
    await t.tdb.db.execute(sql`UPDATE task_runtime.environments SET parent_ending=${JSON.stringify(marker)}::jsonb WHERE id=${pending.original.id}`);
    const before = await t.snapshot();
    pending.finish(); await pending.settled;
    await recordInitialPodFailure(t.deps, pending.original, 'late original failure');
    expect(await t.snapshot()).toEqual(before);
  }, 15000);

  for (const capability of ['absent', 'error'] as const) test('maintenance reader ' + capability + ' has no fallback or writes', async () => {
    const t = await setup(), pending = await t.start(), before = await t.snapshot();
    const original = t.deps.uow;
    const uow: UnitOfWork = { read: original.read, run: fn => original.run(scope => fn({ ...scope, environments: { ...scope.environments,
      getMaintenanceView: capability === 'absent' ? undefined : async () => { throw new Error('original read unavailable'); },
      getById: async () => { throw new Error('forbidden mapper fallback'); },
    } })) };
    const deps = { ...t.deps, uow };
    await recordPodInstance(deps, pending.original, crypto.randomUUID());
    await recordInitialPodFailure(deps, pending.original, 'original error');
    expect(await t.snapshot()).toEqual(before);
    expect(t.warnings).toEqual(capability === 'error' ? ['task initial pod result persistence failed', 'task initial pod result persistence failed'] : []);
  }, 15000);

  test('third-instance UID is not replaced even with otherwise unchanged original creation identity', async () => {
    const t = await setup(), pending = await t.start();
    const third = crypto.randomUUID();
    await t.tdb.db.execute(sql`UPDATE task_runtime.environments SET pod_uid=${third} WHERE id=${pending.original.id}`);
    const before = await t.snapshot(); pending.finish(); await pending.settled;
    await recordInitialPodFailure(t.deps, pending.original, 'old UID error');
    expect(await t.snapshot()).toEqual(before);
  }, 15000);

  test('actual original ending and recovery publication reject results from the completed prior epoch', async () => {
    const physical = await developmentParentPhysicalFixture('native');
    try {
      const original = await physical.load(physical.parent.id), accepted = await acceptParentRebuild(physical);
      const sourceId = readDevelopmentParentEnding(await physical.load(original.id))!.endingId;
      await stopParentForRebuild(physical);
      const current = await physical.load(original.id);
      expect(current).toMatchObject({ state: 'creating', rebuildId: accepted.id });
      expect(current.podName).not.toBe(original.podName); expect(current.runnerTokenHash).not.toBe(original.runnerTokenHash);
      const source = (await physical.uow.read.parentEnding!.endings.get(sourceId))!; expect(source.phase).toBe('complete');
      const before = Array.from(await physical.tdb.db.execute(sql`SELECT row_to_json(e)::text AS value FROM task_runtime.environments e ORDER BY id`));
      const resources = await physical.resources.api.list({ projectId: physical.projectId, includeStopped: true }), used = await physical.resources.api.occupancy(physical.projectId);
      const deps = { ...physical.deps, uow: physical.uow, cluster: kubernetesTaskCluster(physical.k8s, physical.deps.settings.workerUid),
        clock: { now: () => new Date() }, logger: noopLogger };
      await recordPodInstance(deps, original, original.podUid);
      await recordInitialPodFailure(deps, original, 'original epoch late error');
      expect(Array.from(await physical.tdb.db.execute(sql`SELECT row_to_json(e)::text AS value FROM task_runtime.environments e ORDER BY id`))).toEqual(before);
      expect(await physical.resources.api.list({ projectId: physical.projectId, includeStopped: true })).toEqual(resources);
      expect(await physical.resources.api.occupancy(physical.projectId)).toBe(used);
      expect(await physical.uow.read.parentEnding!.endings.get(sourceId)).toEqual(source);
    } finally { await physical.close(); }
  }, 30000);
});
