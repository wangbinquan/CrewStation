// Actual PG admissions and the actual two rendering paths, with a fake cluster and no model/login.
import { afterEach, describe, expect, test } from 'bun:test';
import type { DevelopmentUsageStorage, UserId } from '../../packages/contracts';
import { DEVELOPMENT_USAGE_BINDING_DIRECTORY, DEVELOPMENT_USAGE_DIRECTORY, DevelopmentUsageRuntimeConfigSchema, TaskIdSchema } from '../../packages/contracts';
import { newResourceId } from '../../packages/kernel';
import { Resources } from '../../packages/k8s';
import { testDatabaseAvailable } from '../../packages/testkit';
import { workloadRenderOf } from '../../modules/cluster-control/domain/workloadRender';
import { runnerSecretObject, workloadPodObject } from '../../modules/cluster-control/adapters/k8s/workloadObjects';
import type { CreateNativeExecutionInput } from '../../modules/task-runtime/api/moduleApi';
import { reconcilerCreates } from '../../modules/task-runtime/domain/taskEnvironment';
import { rebuildFixture } from '../../modules/task-runtime/tests/rebuildFixture';

const available = await testDatabaseAvailable();
let f: Awaited<ReturnType<typeof rebuildFixture>> | undefined;
afterEach(async () => { await f?.close(); f = undefined; });
function request(): CreateNativeExecutionInput {
  return { id: TaskIdSchema.parse(newResourceId()), parentTaskId: f!.env.id, purpose: 'agent', agentId: newResourceId(), runnerId: crypto.randomUUID(), fingerprint: 'a'.repeat(64), createdBy: newResourceId() as UserId, developmentUsageStorage: { version: 1 } };
}
function assertLayout(spec: unknown, pvcName: string) {
  const value = spec as { volumes: unknown[]; containers: Array<{ env: unknown[]; volumeMounts: unknown[] }> };
  expect(value.volumes).toEqual([{ name: 'work', persistentVolumeClaim: { claimName: pvcName } }, { name: 'development-usage', emptyDir: {} }, { name: 'development-usage-binding', emptyDir: {} }]);
  expect(value.containers[0]!.volumeMounts).toContainEqual({ name: 'work', mountPath: '/work', readOnly: false });
  expect(value.containers[0]!.volumeMounts).toContainEqual({ name: 'development-usage', mountPath: DEVELOPMENT_USAGE_DIRECTORY, readOnly: false });
  expect(value.containers[0]!.volumeMounts).toContainEqual({ name: 'development-usage-binding', mountPath: DEVELOPMENT_USAGE_BINDING_DIRECTORY, readOnly: false });
  expect(value.containers[0]!.env).toContainEqual({ name: 'CS_RUNTIME_POD_UID', valueFrom: { fieldRef: { fieldPath: 'metadata.uid' } } });
}

describe.skipIf(!available)('numeric selection survives admission, PG, projection and both real renderers', () => {
  for (const ledger of [false, true]) test(`${ledger ? 'ledger' : 'direct'} render keeps the original work volume and persists the explicit numeric choice`, async () => {
    f = await rebuildFixture({ running: true, ledger }); f.state.quota = 4;
    const input = request(), before = structuredClone([...f.k8s.objects]);
    const child = await f.runtime.api.createNativeExecution(input);
    expect((await f.runtime.api.createNativeExecution(input)).id).toBe(child.id);
    const saved = (await f.uow.read.environments.getById(child.id))!;
    expect(saved.render?.developmentUsageStorage).toEqual({ version: 1 });
    expect(reconcilerCreates(saved)).toBe(ledger);
    expect([...f.k8s.objects]).toEqual(before);
    let values: Record<string, string>;
    if (ledger) {
      expect(saved.render?.execution).toEqual({ workspacePod: f.env.podName });
      const record = (await f.resources!.api.get(child.id))!;
      const render = workloadRenderOf(record.id, record.spec)!;
      expect(render.pod.developmentUsageStorage).toEqual({ version: 1 });
      expect(render.pod.workspace).toMatchObject({ pod: f.env.podName, podUid: saved.native!.parentPodUid, pvcUid: saved.native!.pvcUid });
      values = await f.runtime.api.runnerValues(child.id);
      const secret = await f.k8s.create(runnerSecretObject(render.pod, values)), pod = await f.k8s.create(workloadPodObject(render.pod));
      assertLayout(pod.spec, f.env.pvcName);
      await f.runtime.api.bindWorkload(child.id, pod.metadata.uid!, secret.metadata.uid!);
    } else {
      expect(saved.render?.execution).toBeUndefined();
      await f.runNative();
      const pod = (await f.k8s.get(Resources.Pod!, saved.podName, saved.namespace))!;
      const secret = (await f.k8s.get(Resources.Secret!, `${saved.podName}-runner`, saved.namespace))!;
      assertLayout(pod.spec, f.env.pvcName);
      values = secret.stringData as Record<string, string>;
      expect((await f.uow.read.environments.getById(child.id))?.native?.podUid).toBe(pod.metadata.uid);
    }
    expect(DevelopmentUsageRuntimeConfigSchema.parse(JSON.parse(values.CS_RUNNER_DEVELOPMENT_USAGE!))).toEqual({ version: 1, projectId: saved.projectId, workspaceTaskId: f.env.id, directory: DEVELOPMENT_USAGE_DIRECTORY, bindingDirectory: DEVELOPMENT_USAGE_BINDING_DIRECTORY });
    expect(await f.runtime.api.onRunnerConnected(child.id, values.CS_RUNNER_TOKEN!)).toBe(true);
    expect(await f.runtime.api.getEnvironment(child.id)).toMatchObject({ state: 'running', native: { purpose: 'agent', parentTaskId: f.env.id } });
    for (const [key, object] of before) expect(f.k8s.objects.get(key)).toEqual(object);
  });

  for (const ledger of [false, true]) test(`${ledger ? 'ledger' : 'direct'} retries reject both addition and removal, while old headless and CLI layouts stay unchanged`, async () => {
    f = await rebuildFixture({ running: true, ledger }); f.state.quota = 6;
    const numeric = request(), old = { ...request(), developmentUsageStorage: undefined };
    await f.runtime.api.createNativeExecution(numeric); await f.runtime.api.createNativeExecution(old);
    await expect(f.runtime.api.createNativeExecution({ ...numeric, developmentUsageStorage: undefined })).rejects.toMatchObject({ kind: 'conflict' });
    await expect(f.runtime.api.createNativeExecution({ ...old, developmentUsageStorage: { version: 1 } })).rejects.toMatchObject({ kind: 'conflict' });
    const legacy = (await f.uow.read.environments.getById(old.id))!;
    expect(legacy.render?.developmentUsageStorage).toBeUndefined();
    const cli = { ...request(), purpose: 'cli' as const, developmentUsageStorage: undefined };
    await f.runtime.api.createNativeExecution(cli);
    if (!ledger) for (let queued = 0; queued < 3; queued++) await f.runNative();
    for (const id of [old.id, cli.id]) {
      const saved = (await f.uow.read.environments.getById(id))!;
      if (ledger) {
        const record = (await f.resources!.api.get(id))!, render = workloadRenderOf(record.id, record.spec)!;
        expect((workloadPodObject(render.pod).spec as { volumes: unknown[] }).volumes).toHaveLength(1);
        expect((await f.runtime.api.runnerValues(id)).CS_RUNNER_DEVELOPMENT_USAGE).toBeUndefined();
      } else {
        expect(((await f.k8s.get(Resources.Pod!, saved.podName, saved.namespace))!.spec as { volumes: unknown[] }).volumes).toHaveLength(1);
      }
    }
  });

  test('CLI, business subtask, unknown numeric version and unknown selection fields never get admitted', async () => {
    f = await rebuildFixture({ running: true }); f.state.quota = 6;
    for (const purpose of ['cli', 'subtask'] as const) await expect(f.runtime.api.createNativeExecution({ ...request(), purpose })).rejects.toMatchObject({ kind: 'precondition' });
    for (const invalid of [null, { version: 2 }, { version: 1, directory: '/work' }]) await expect(f.runtime.api.createNativeExecution({ ...request(), developmentUsageStorage: invalid as DevelopmentUsageStorage })).rejects.toMatchObject({ kind: 'precondition' });
    expect(await f.runtime.api.runningTaskCount(f.projectId)).toBe(1);
  });
});
