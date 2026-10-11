// Real PG and original native admission. Diagnostic reconnect cannot authorize physical cleanup.
import { afterEach, describe, expect, test } from 'bun:test';
import { Resources } from '@crewstation/k8s';
import { testDatabaseAvailable } from '@crewstation/testkit';
import { sql } from 'drizzle-orm';
import { developmentCleanupSelection } from '../domain/development/cleanupSelection';
import { developmentCleanupFixture } from './developmentCleanupFixture';
import type { DevelopmentCleanupFixture } from './developmentCleanupFixture';

const available = await testDatabaseAvailable();
describe.skipIf(!available)('original selected development cleanup diagnostic connection (real PG)', () => {
  let f: DevelopmentCleanupFixture | undefined;
  afterEach(async () => { await f?.close(); f = undefined; });
  async function prepare(sealed = false) {
    f = await developmentCleanupFixture('ledger', true, true);
    f.control.permitted = false;
    const current = await f.load(f.env.id);
    const secret = (await f.k8s.get(Resources.Secret!, current.podName + '-runner', current.namespace))!;
    const token = (secret.stringData as Record<string, string>).CS_RUNNER_TOKEN!;
    const rejection = { code: 'protocol_mismatch' as const, runnerProtocol: 2, message: 'original diagnostic retained', at: current.updatedAt.toISOString() };
    await f.uow.run(scope => scope.environments.update({ ...current, connected: false, runnerRejection: rejection, message: rejection.message }));
    if (sealed) {
      await f.k8s.mergePatch(Resources.PersistentVolumeClaim!, f.parent.pvcName, f.parent.namespace, { status: { phase: 'Bound', capacity: { storage: f.profiles[0]!.storage } } });
      await f.runtime.api.releaseEnvironment(f.parent.id, 'user');
    }
    return token;
  }
  async function snapshot() {
    const env = await f!.load(f!.env.id);
    return { env, parent: await f!.load(f!.parent.id), physical: structuredClone([...f!.k8s.objects]),
      occupancy: await f!.resources.api.occupancy(env.projectId), resources: await f!.resources.api.list({}), selection: developmentCleanupSelection(env) };
  }
  async function unchanged(before: Awaited<ReturnType<typeof snapshot>>) {
    expect(await snapshot()).toEqual(before);
    expect(f!.physical.state.deleteRequests).toEqual([]);
    expect(f!.control.calls).toBe(0);
  }
  test('first, repeated and module-reconstructed original hello updates only three diagnostic fields while digital evidence waits', async () => {
    const token = await prepare(), before = await snapshot();
    expect(before.env).toMatchObject({ state: 'releasing', connected: false, native: { state: 'cleaning' } });
    const at = new Date(before.env.updatedAt.getTime() + 1000);
    f!.replace({ developmentCleanup: f!.participant, clock: { now: () => at } });
    for (const reconstructed of [false, false, true]) {
      if (reconstructed) f!.replace({ developmentCleanup: f!.participant, clock: { now: () => at } });
      expect(await f!.runtime.api.onRunnerConnected(before.env.id, token)).toBe(true);
      const after = await snapshot();
      expect(after).toEqual({ ...before, env: { ...before.env, connected: true, lastActivityAt: at, updatedAt: at } });
      expect(f!.physical.state.deleteRequests).toEqual([]); expect(f!.control.calls).toBe(0);
    }
  });
  test('the original sealed parent epoch is awakened without changing either original environment or permitting cleanup', async () => {
    const token = await prepare(true), before = await snapshot();
    expect(before.parent.parentEnding).toBeDefined();
    expect(await f!.runtime.api.onRunnerConnected(before.env.id, token)).toBe(true);
    const after = await snapshot();
    expect(after).toEqual({ ...before, env: { ...before.env, connected: true, lastActivityAt: after.env.lastActivityAt, updatedAt: after.env.updatedAt } });
    expect(f!.physical.state.deleteRequests).toEqual([]); expect(f!.control.calls).toBe(0);
  });
  test('a different token cannot advance or reclaim the original selected cleaning execution', async () => {
    await prepare(); const before = await snapshot();
    expect(await f!.runtime.api.onRunnerConnected(before.env.id, 'different-token')).toBe(false);
    await unchanged(before);
  });
  for (const missing of ['podUid', 'secretUid'] as const) test('missing original native ' + missing + ' is rejected before diagnostics', async () => {
    const token = await prepare(), original = await f!.load(f!.env.id);
    await f!.uow.run(scope => scope.environments.update({ ...original, native: { ...original.native!, [missing]: undefined } }));
    const before = { env: await f!.load(original.id), physical: structuredClone([...f!.k8s.objects]), occupancy: await f!.resources.api.occupancy(original.projectId) };
    await expect(f!.runtime.api.onRunnerConnected(original.id, token)).rejects.toMatchObject({ kind: 'precondition' });
    expect(await f!.load(original.id)).toEqual(before.env); expect([...f!.k8s.objects]).toEqual(before.physical);
    expect(await f!.resources.api.occupancy(original.projectId)).toBe(before.occupancy);
    expect(f!.physical.state.deleteRequests).toEqual([]);
  });
  test('a mismatched original bound Pod UID is not admitted through the cleanup branch', async () => {
    const token = await prepare(), original = await f!.load(f!.env.id);
    await f!.uow.run(scope => scope.environments.update({ ...original, podUid: crypto.randomUUID() }));
    const before = await f!.load(original.id), physical = structuredClone([...f!.k8s.objects]);
    await expect(f!.runtime.api.onRunnerConnected(original.id, token)).rejects.toMatchObject({ kind: 'precondition' });
    expect(await f!.load(original.id)).toEqual(before); expect([...f!.k8s.objects]).toEqual(physical);
  });
  test('an explicit malformed original protection cannot be downgraded to legacy absence', async () => {
    const token = await prepare();
    await f!.tdb.db.execute(sql`UPDATE task_runtime.environments SET render=jsonb_set(render,ARRAY['developmentUsageProtection']::text[],'false'::jsonb,true) WHERE id=${f!.env.id}`);
    const before = await f!.load(f!.env.id), physical = structuredClone([...f!.k8s.objects]);
    await expect(f!.runtime.api.onRunnerConnected(f!.env.id, token)).rejects.toMatchObject({ kind: 'precondition' });
    expect(await f!.load(f!.env.id)).toEqual(before); expect([...f!.k8s.objects]).toEqual(physical);
  });
  for (const sealed of [false, true]) for (const missing of [false, true]) test((sealed ? 'sealed' : 'ordinary') + (missing ? ' missing' : ' changed') + ' parent Pod UID cannot borrow a diagnostic exception', async () => {
    const token = await prepare(sealed), parent = await f!.load(f!.parent.id);
    await f!.uow.run(scope => scope.environments.update({ ...parent, podUid: missing ? undefined : crypto.randomUUID() }));
    const before = await snapshot();
    await expect(f!.runtime.api.onRunnerConnected(before.env.id, token)).rejects.toMatchObject({ kind: 'precondition' });
    await unchanged(before);
  });
  test('an unselected legacy cleaning execution retains its previous refusal', async () => {
    const token = await prepare();
    await f!.tdb.db.execute(sql`UPDATE task_runtime.environments SET render=render-'developmentUsageProtection'-'developmentRemovalProtection' WHERE id=${f!.env.id}`);
    const before = await snapshot();
    expect(before.selection).toBeUndefined(); expect(await f!.runtime.api.onRunnerConnected(before.env.id, token)).toBe(false);
    await unchanged(before);
  });
});
