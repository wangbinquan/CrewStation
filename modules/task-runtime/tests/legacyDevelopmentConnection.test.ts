// Real Task APIs, PG and original native factory; compatibility never grants a new execution.
import { afterEach, describe, expect, test } from 'bun:test';
import type { TaskId, UserId } from '@crewstation/contracts';
import { Resources } from '@crewstation/k8s';
import { newId } from '@crewstation/kernel';
import { testDatabaseAvailable } from '@crewstation/testkit';
import { sql } from 'drizzle-orm';
import { assertDevelopmentWriter } from '../application/development/parent/admission';
import { rebuildFixture } from './rebuildFixture';

const available = await testDatabaseAvailable();
let f: Awaited<ReturnType<typeof rebuildFixture>> | undefined;
afterEach(async () => { await f?.close(); f = undefined; });
async function child(running = true) {
  f = await rebuildFixture({ running: true }); f.state.quota = 4;
  const env = await f.runtime.api.createNativeExecution({ id: newId('tsk') as TaskId, parentTaskId: f.env.id,
    createdBy: '01a0bf5d-8f4b-7ed2-8386-a4b2e1a36efb' as UserId, agentId: newId('agt'), terminalId: newId('pty'),
    runnerId: crypto.randomUUID(), fingerprint: 'f'.repeat(64), profile: f.state.profiles[0]!.id });
  await f.runNative();
  const secret = (await f.k8s.get(Resources.Secret!, env.podName + '-runner', f.env.namespace))!;
  const token = (secret.stringData as Record<string, string>).CS_RUNNER_TOKEN!;
  if (running) expect(await f.runtime.api.onRunnerConnected(env.id, token)).toBe(true);
  return { env: (await f.uow.read.environments.getById(env.id))!, token };
}
async function rebuildParent() {
  await f!.k8s.mergePatch(Resources.Pod!, f!.env.podName, f!.env.namespace, { status: { phase: 'Failed', reason: 'OOMKilled' } });
  await f!.runtime.api.reconcile();
  await f!.runtime.api.requestRebuild(f!.projectId, await f!.request()); await f!.run();
}
describe.skipIf(!available)('original legacy CLI connection after parent rebuild', () => {
  test('the valid reconnect changes only diagnostics; original rejection, Pod, Secret, hash, UID, render and quota stay intact', async () => {
    const { env, token } = await child(); await rebuildParent();
    const rejection = { code: 'protocol_mismatch' as const, runnerProtocol: 2, message: 'keep original diagnosis', at: '2026-10-02T00:00:00Z' };
    await f!.uow.run((scope) => scope.environments.update({ ...env, connected: false, runnerRejection: rejection, message: rejection.message }));
    const before = (await f!.uow.read.environments.getById(env.id))!, physical = structuredClone([...f!.k8s.objects]);
    const parent = (await f!.uow.read.environments.getById(f!.env.id))!, rebuild = await f!.uow.read.rebuilds.get(parent.rebuildId!);
    expect(await f!.runtime.api.onRunnerConnected(env.id, 'invalid-original-token')).toBe(false);
    expect(await f!.runtime.api.onRunnerConnected(env.id, token)).toBe(true);
    const after = (await f!.uow.read.environments.getById(env.id))!;
    expect(after).toEqual({ ...before, connected: true, updatedAt: after.updatedAt, lastActivityAt: after.lastActivityAt });
    expect(after.lastActivityAt.getTime()).toBeGreaterThan(before.lastActivityAt.getTime());
    expect([...f!.k8s.objects]).toEqual(physical);
    expect(await f!.uow.read.rebuilds.get(parent.rebuildId!)).toEqual(rebuild);
    expect(await f!.runtime.api.runningTaskCount(f!.projectId)).toBe(2);
  });
  test('a normal reconnect on the unchanged parent retains its original successful handshake behavior', async () => {
    const { env, token } = await child();
    await f!.runtime.api.onRunnerRejected(env.id, token, { code: 'protocol_mismatch', runnerProtocol: 2, message: 'old rejection' });
    expect(await f!.runtime.api.onRunnerConnected(env.id, token)).toBe(true);
    expect((await f!.uow.read.environments.getById(env.id))?.runnerRejection).toBeUndefined();
  });
  for (const mode of ['first-starting', 'agent', 'unbound', 'changed-bound'] as const) test(mode + ': cannot borrow the original CLI diagnostic exception', async () => {
    const { env, token } = await child(mode !== 'first-starting'); await rebuildParent();
    const native = { ...env.native!, ...(mode === 'agent' ? { purpose: 'agent' as const } : {}),
      ...(mode === 'unbound' ? { podUid: undefined } : {}) };
    const changed = { ...env, native, ...(mode === 'changed-bound' ? { podUid: 'different-child-instance' } : {}) };
    await f!.uow.run((scope) => scope.environments.update(changed));
    const before = (await f!.uow.read.environments.getById(env.id))!, physical = structuredClone([...f!.k8s.objects]);
    await expect(f!.runtime.api.onRunnerConnected(env.id, token)).rejects.toMatchObject({ kind: 'precondition' });
    expect(await f!.uow.read.environments.getById(env.id)).toEqual(before); expect([...f!.k8s.objects]).toEqual(physical);
  });
  for (const where of ['developmentUsageStorage', 'developmentUsageProtection', 'developmentRemovalProtection', 'developmentUsageRequestHash', 'developmentCleanup', 'developmentRemovalSeal'] as const)
    test('explicit malformed ' + where + ' remains selected after actual PG mapping', async () => {
      const { env, token } = await child(); await rebuildParent();
      const native = where === 'developmentCleanup' || where === 'developmentRemovalSeal';
      await f!.tdb.db.execute(native
        ? sql`UPDATE task_runtime.environments SET native=jsonb_set(native,ARRAY[${where}]::text[],'false'::jsonb,true) WHERE id=${env.id}`
        : sql`UPDATE task_runtime.environments SET render=jsonb_build_object(${where}::text,false) WHERE id=${env.id}`);
      const before = (await f!.uow.read.environments.getById(env.id))!;
      await expect(f!.runtime.api.onRunnerConnected(env.id, token)).rejects.toMatchObject({ kind: 'precondition' });
      expect(await f!.uow.read.environments.getById(env.id)).toEqual(before);
    });
  for (const render of ['false', 'null', '[]']) test('raw JSONB render ' + render + ' cannot be mistaken for legacy absence', async () => {
    const { env, token } = await child(); await rebuildParent();
    await f!.tdb.db.execute(sql`UPDATE task_runtime.environments SET render=${render}::jsonb WHERE id=${env.id}`);
    expect(await f!.uow.read.environments.getMaintenanceView!(env.id)).toEqual({ status: 'malformed' });
    const before = (await f!.uow.read.environments.getById(env.id))!;
    await expect(f!.runtime.api.onRunnerConnected(env.id, token)).rejects.toMatchObject({ kind: 'precondition' });
    expect(await f!.uow.read.environments.getById(env.id)).toEqual(before);
  });
  test('an expected material witness and every default physical writer keep the original parent UID check', async () => {
    const { env } = await child();
    const expected = await f!.uow.run((scope) => assertDevelopmentWriter(scope, env)); await rebuildParent();
    await expect(f!.uow.run((scope) => assertDevelopmentWriter(scope, env))).rejects.toMatchObject({ kind: 'precondition' });
    await expect(f!.uow.run((scope) => assertDevelopmentWriter(scope, env, expected, 'existing-legacy-connection'))).rejects.toMatchObject({ kind: 'precondition' });
  });
});
