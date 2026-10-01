// RFC-034: actual PG Task/Resources owners and live object materials, rather than labels or cached admission data.
import { afterEach, describe, expect, test } from 'bun:test';
import { DEVELOPMENT_REMOVAL_ANNOTATION } from '@crewstation/contracts';
import { Resources } from '@crewstation/k8s';
import { testDatabaseAvailable } from '@crewstation/testkit';
import { sql } from 'drizzle-orm';
import { developmentCleanupFixture } from './developmentCleanupFixture';
import type { DevelopmentCleanupFixture } from './developmentCleanupFixture';

const available = await testDatabaseAvailable();
describe.skipIf(!available)('RFC-034 original physical deletion lookup', () => {
  let f: DevelopmentCleanupFixture;
  afterEach(async () => { await f?.close(); });
  const target = (kind: 'Pod' | 'Secret', suffix = '', operation: 'delete' | 'stop-finalizer' = 'delete') => ({
    kind, namespace: f.env.namespace, name: f.env.podName + suffix,
    uid: kind === 'Pod' ? f.env.native!.podUid! : suffix === '-runner' ? f.env.native!.secretUid! : '', operation,
  });
  const stop = async () => {
    const removed = f.wait('finalizer-removed'), controller = f.controller(); controller.observer.start();
    await removed; await controller.reconciled(); await controller.observer.stop();
  };
  for (const mode of ['ledger', 'native'] as const) for (const historical of [false, true]) {
    test(mode + (historical ? ' original unmarked' : ' newly marked') + ': original admission and numeric copy are required before Pod intent; Secrets wait for full independent stop', async () => {
      f = await developmentCleanupFixture(mode, true, true, historical);
      const pod = target('Pod'), query = f.runtime.api.inspectDevelopmentRemoval;
      for (const [kind, suffix] of [['Pod', ''], ['Secret', '-runner'], ['Secret', '-admission']] as const) {
        expect((await f.k8s.get(Resources[kind]!, f.env.podName + suffix, f.env.namespace))?.metadata.annotations?.[DEVELOPMENT_REMOVAL_ANNOTATION]).toBe(historical ? undefined : '1');
      }
      expect(JSON.stringify(f.env.render)).not.toContain(DEVELOPMENT_REMOVAL_ANNOTATION);
      expect(await query(pod)).toMatchObject({ kind: 'waiting' });
      f.control.permitted = false; await f.runNative();
      expect(f.physical.state.deleteRequests).toEqual([]);
      f.control.permitted = true; await f.runNative();
      const live = (await f.k8s.get(Resources.Pod!, f.env.podName, f.env.namespace))!;
      expect(await query(pod)).toEqual({ kind: 'permitted', resourceVersion: live.metadata.resourceVersion! });
      expect(await query({ ...pod, uid: crypto.randomUUID() })).toMatchObject({ kind: 'waiting' });
      expect(await query({ ...pod, operation: 'stop-finalizer' })).toMatchObject({ kind: 'waiting' });
      const originalSpec = structuredClone(live.spec);
      await f.k8s.mergePatch(Resources.Pod!, pod.name, pod.namespace, { spec: { initContainers: [] } });
      expect(await query(pod)).toMatchObject({ kind: 'waiting' });
      await f.k8s.mergePatch(Resources.Pod!, pod.name, pod.namespace, { spec: originalSpec });
      const runner = target('Secret', '-runner');
      expect(await query(runner)).toMatchObject({ kind: 'waiting' });
      await stop();
      const secret = (await f.k8s.get(Resources.Secret!, runner.name, runner.namespace))!;
      expect(await query(runner)).toEqual({ kind: 'permitted', resourceVersion: secret.metadata.resourceVersion! });
      const originalUid = secret.metadata.uid!;
      await f.k8s.mergePatch(Resources.Secret!, runner.name, runner.namespace, { metadata: { uid: crypto.randomUUID() } });
      expect(await query(runner)).toMatchObject({ kind: 'waiting' });
      await f.k8s.mergePatch(Resources.Secret!, runner.name, runner.namespace, { metadata: { uid: originalUid }, stringData: { CS_RUNNER_TOKEN: 'replaced' } });
      expect(await query(runner)).toMatchObject({ kind: 'waiting' });
      const admission = (await f.k8s.get(Resources.Secret!, f.env.podName + '-admission', f.env.namespace))!;
      expect(await query({ ...target('Secret', '-admission'), uid: admission.metadata.uid! })).toMatchObject({ kind: 'permitted' });
      await f.k8s.mergePatch(Resources.Secret!, admission.metadata.name, f.env.namespace, { metadata: { uid: crypto.randomUUID() } });
      expect(await query({ ...target('Secret', '-admission'), uid: admission.metadata.uid! })).toMatchObject({ kind: 'waiting' });
    }, 15000);
  }
  test('all lifecycle states are indexed by original namespace and full physical name; malformed selections cannot fall back to legacy', async () => {
    f = await developmentCleanupFixture('ledger', true, true);
    const original = await f.load(f.env.id), query = f.runtime.api.inspectDevelopmentRemoval;
    expect(await query({ ...target('Pod'), namespace: 'other-project' })).toEqual({ kind: 'unselected' });
    expect(await query({ ...target('Secret', '-checkout'), uid: crypto.randomUUID() })).toEqual({ kind: 'unselected' });
    for (const state of ['creating', 'running', 'paused', 'releasing', 'released', 'failed']) {
      await f.tdb.db.execute(sql`UPDATE task_runtime.environments SET state = ${state} WHERE id = ${f.env.id}`);
      expect(await query(target('Pod'))).toMatchObject({ kind: 'waiting' });
    }
    for (const flag of [null, false, 0, {}, { version: 2 }]) {
      await f.uow.run((scope) => scope.environments.update({ ...original, render: { ...original.render!, developmentRemovalProtection: flag } } as typeof original));
      expect(await query(target('Pod'))).toMatchObject({ kind: 'waiting' });
    }
    await f.uow.run((scope) => scope.environments.update({ ...original, render: { ...original.render!, developmentRemovalProtection: undefined } }));
    expect(await query(target('Pod'))).toEqual({ kind: 'unselected' });
    await f.uow.run((scope) => scope.environments.update(original));
    await f.runNative(); expect(await query(target('Pod'))).toMatchObject({ kind: 'permitted' });
    await f.tdb.db.execute(sql`INSERT INTO task_runtime.environments SELECT (jsonb_populate_record(NULL::task_runtime.environments, to_jsonb(e) || jsonb_build_object('id', ${crypto.randomUUID()}::text))).* FROM task_runtime.environments e WHERE id = ${f.env.id}`);
    expect(await query(target('Pod'))).toMatchObject({ kind: 'waiting' });
  });
  test('closed admissions, historical receipt and live reads cannot be replaced with cached absence or a query failure', async () => {
    f = await developmentCleanupFixture('native', true, true); await f.runNative();
    const query = f.runtime.api.inspectDevelopmentRemoval, get = f.safety.get;
    f.safety.get = async () => undefined;
    expect(await query(target('Pod'))).toMatchObject({ kind: 'waiting' });
    f.safety.get = get;
    const original = await get(f.env.render!.workloadConsumerId!);
    f.safety.get = async () => ({ ...original!, developmentAdmission: undefined });
    expect(await query(target('Pod'))).toMatchObject({ kind: 'waiting' });
    f.safety.get = get;
    const raw = f.k8s.get;
    f.k8s.get = async () => { throw new Error('unavailable confidential upstream'); };
    const failed = await query(target('Pod'));
    expect(failed).toEqual({ kind: 'waiting', reason: 'development-removal-evidence-pending' });
    expect(JSON.stringify(failed)).not.toContain('confidential'); f.k8s.get = raw;
    await f.tdb.db.execute(sql`ALTER TABLE task_runtime.environments RENAME TO original_environments`);
    try { expect(await query(target('Pod'))).toMatchObject({ kind: 'waiting' }); }
    finally { await f.tdb.db.execute(sql`ALTER TABLE task_runtime.original_environments RENAME TO environments`); }
  });
  test('atomic terminal seal survives token rotation and Resources compaction; an old terminal without seal never downgrades', async () => {
    f = await developmentCleanupFixture('ledger', true, true);
    const originals = await Promise.all(['-runner', '-admission'].map((suffix) => f.k8s.get(Resources.Secret!, f.env.podName + suffix, f.env.namespace)));
    await f.runNative(); await stop(); await f.runNative(); await f.settle();
    const finished = await f.load(f.env.id);
    expect(finished.native?.state).toBe('finished'); expect(finished.runnerTokenHash).not.toBe(f.env.runnerTokenHash);
    expect(finished.native?.developmentRemovalSeal).toMatchObject({ originalRunnerTokenHash: f.env.runnerTokenHash, selectionHash: finished.native!.developmentCleanup!.selection.selectionHash });
    // Compact removes ledger child claims; Task's original physical-name lookup remains authoritative.
    await f.tdb.db.execute(sql`UPDATE resources.records SET phase_since = clock_timestamp() - interval '8 days' WHERE id = ${f.env.id}`);
    await f.resources.maintainOnce();
    expect((await f.resources.api.get(f.env.id))?.compactedAt).toBeDefined();
    expect((await f.resources.api.get(f.env.id))?.children).toEqual([]);
    for (const secret of originals) {
      await f.k8s.create(secret!);
      const selected = { ...target('Secret', secret!.metadata.name.endsWith('-runner') ? '-runner' : '-admission'), uid: secret!.metadata.uid! };
      expect(await f.runtime.api.inspectDevelopmentRemoval(selected)).toMatchObject({ kind: 'permitted' });
    }
    await f.uow.run((scope) => scope.environments.update({ ...finished, native: { ...finished.native!, developmentRemovalSeal: undefined } }));
    expect(await f.runtime.api.inspectDevelopmentRemoval(target('Secret', '-runner'))).toMatchObject({ kind: 'waiting' });
  }, 15000);
});
