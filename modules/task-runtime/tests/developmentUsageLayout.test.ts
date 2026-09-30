// Real isolated task-runtime PG and module composition, fake K8s only; no real Agent or model.
import { afterEach, describe, expect, test } from 'bun:test';
import type { TaskId } from '@crewstation/contracts';
import { sql } from 'drizzle-orm';
import { newId } from '@crewstation/kernel';
import { testDatabaseAvailable } from '@crewstation/testkit';
import { rebuildFixture } from './rebuildFixture';
import { layoutExecution, restoreLayoutModule } from './developmentUsageLayoutFixture';
import type { LayoutFixture } from './developmentUsageLayoutFixture';
const available = await testDatabaseAvailable();
let f: LayoutFixture | undefined;
afterEach(async () => { await f?.close(); f = undefined; });
async function footprint() {
  return { environments: await f!.tdb.db.execute(sql`select * from task_runtime.environments order by id`),
    jobs: await f!.tdb.db.execute(sql`select * from platform_infra.jobs order by id`), k8s: structuredClone([...f!.k8s.objects]) };
}
describe.skipIf(!available)('Independent actual development layout lookup (real PG)', () => {
  test('only successful SQL absence is explicit; public DTO, legacy Agent, CLI and original parent remain compatible with no writes', async () => {
    f = await rebuildFixture({ running: true }); f.state.quota = 5;
    const request = layoutExecution(f), missing = newId('tsk') as TaskId;
    const before = await footprint();
    expect(await f.runtime.api.lookupDevelopmentUsageLayout(missing)).toEqual({ version: 1, executionTaskId: missing, kind: 'absent' });
    expect(await f.runtime.api.lookupDevelopmentUsageLayout(f.env.id)).toEqual({ version: 1, executionTaskId: f.env.id, kind: 'legacy' });
    await expect(f.runtime.api.lookupDevelopmentUsageLayout('bad' as TaskId)).rejects.toThrow();
    expect(await footprint()).toEqual(before);
    const { developmentUsageStorage: _layout, ...old } = request;
    const legacy = await f.runtime.api.createNativeExecution(old), cli = await f.runtime.api.createNativeExecution({ ...old, id: newId('tsk') as TaskId, agentId: newId('agt'), purpose: 'cli', terminalId: newId('pty') });
    const after = await footprint();
    for (const id of [legacy.id, cli.id]) expect(await f.runtime.api.lookupDevelopmentUsageLayout(id)).toEqual({ version: 1, executionTaskId: id, kind: 'legacy' });
    expect(await footprint()).toEqual(after);
    await expect(f.runtime.api.createNativeExecution(request)).rejects.toMatchObject({ kind: 'conflict' });
    for (const id of [f.env.id, legacy.id, cli.id]) {
      const publicDto = await f.runtime.api.getEnvironment(id);
      for (const field of ['developmentUsageStorage', 'layout', 'runnerTokenHash', 'render']) expect(publicDto).not.toHaveProperty(field);
    }
  });
  test('selected actual child retains original profile and layout across offline module reconstruction, with nullable instance and no current lookup', async () => {
    f = await rebuildFixture({ running: true }); const request = layoutExecution(f);
    await f.runtime.api.createNativeExecution(request);
    const original = (await f.uow.read.environments.getById(request.id))!, before = await footprint();
    const value = await f.runtime.api.lookupDevelopmentUsageLayout(request.id);
    expect(value).toEqual({ version: 1, executionTaskId: request.id, kind: 'selected', layout: { version: 1 }, projectId: f.projectId, workspaceTaskId: f.env.id, agentId: request.agentId,
      profileId: request.computeProfile!.profileId, profileRevision: 3, namespace: original.namespace, podName: original.podName, podUid: null, state: 'creating', nativeState: 'queued', renderStart: 1, revision: original.updatedAt.toISOString() });
    f.state.profiles[0]!.memory = '128Gi'; const restarted = restoreLayoutModule(f);
    expect(await restarted.api.lookupDevelopmentUsageLayout(request.id)).toEqual(value);
    expect(await footprint()).toEqual(before);
    const replayTarget = await f.runtime.api.getEnvironment(request.id); expect(replayTarget).toBeDefined();
    if (!replayTarget) throw new Error('Expected the original persisted execution');
    expect(await f.runtime.api.createNativeExecution(request)).toEqual(replayTarget);
    const { developmentUsageStorage: _layout, ...changed } = request;
    await expect(f.runtime.api.createNativeExecution(changed)).rejects.toMatchObject({ kind: 'conflict' });
    const publicDto = await f.runtime.api.getEnvironment(request.id);
    for (const field of ['layout', 'developmentUsageStorage', 'runnerTokenHash', 'render', 'profileRevision']) expect(publicDto).not.toHaveProperty(field);
    await f.tdb.db.execute(sql`update task_runtime.environments set pod_uid='original-instance',native=jsonb_set(native,'{podUid}','"original-instance"'::jsonb) where id=${request.id}`);
    expect(await restarted.api.lookupDevelopmentUsageLayout(request.id)).toMatchObject({ kind: 'selected', podUid: 'original-instance' });
    await f.tdb.db.execute(sql`update task_runtime.environments set pod_uid='other-instance' where id=${request.id}`);
    await expect(restarted.api.lookupDevelopmentUsageLayout(request.id)).rejects.toThrow('conflicting');
    await f.tdb.db.execute(sql`update task_runtime.environments set pod_uid='original-instance' where id=${request.id}`);
    expect(await restarted.api.lookupDevelopmentUsageLayout(request.id)).toMatchObject({ kind: 'selected', podUid: 'original-instance' });
  });
  test('actual corrupted selected metadata and SQL failure stay errors; another execution cannot substitute and absence has no fallback', async () => {
    f = await rebuildFixture({ running: true }); f.state.quota = 4;
    const request = layoutExecution(f); await f.runtime.api.createNativeExecution(request);
    const other = { ...layoutExecution(f), computeProfile: { profileId: f.state.profiles[1]!.id, revision: 7 } };
    await f.runtime.api.createNativeExecution(other);
    expect(await f.runtime.api.lookupDevelopmentUsageLayout(other.id)).toMatchObject({ executionTaskId: other.id, agentId: other.agentId, profileId: other.computeProfile.profileId, profileRevision: 7 });
    const original = (await f.uow.read.environments.getById(request.id))!;
    for (const patch of [sql`render=jsonb_set(render,'{developmentUsageStorage}','{"version":2}'::jsonb)`, sql`native=native-'computeProfile'`, sql`native=jsonb_set(native,'{purpose}','"cli"'::jsonb)`]) {
      await f.tdb.db.execute(sql`update task_runtime.environments set ${patch} where id=${request.id}`);
      await expect(f.runtime.api.lookupDevelopmentUsageLayout(request.id)).rejects.toThrow();
      await f.tdb.db.execute(sql`update task_runtime.environments set render=${JSON.stringify(original.render)}::jsonb,native=${JSON.stringify(original.native)}::jsonb where id=${request.id}`);
    }
    const restarted = restoreLayoutModule(f), saved = await restarted.api.lookupDevelopmentUsageLayout(request.id);
    await f.tdb.db.execute(sql`alter table task_runtime.environments rename to layout_query_unavailable`);
    try {
      await expect(restarted.api.lookupDevelopmentUsageLayout(request.id)).rejects.toBeDefined();
      await expect(restarted.api.lookupDevelopmentUsageLayout(newId('tsk') as TaskId)).rejects.toBeDefined();
    } finally { await f.tdb.db.execute(sql`alter table task_runtime.layout_query_unavailable rename to environments`); }
    expect(await restarted.api.lookupDevelopmentUsageLayout(request.id)).toEqual(saved);
  });
});
