// RFC-043 RIU-06 — recovery follows the current pin once a task has been upgraded.
// Why these tests exist: material proof, rebuild and restart read the admission snapshot, whose task reference an upgrade
// releases. They would report `original_image_incompatible` for a healthy upgraded task, or copy a reference the task no
// longer holds. These lock that every recovery reader takes the current pin and that a pre-upgrade assessment goes stale.
import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { eq } from 'drizzle-orm';
import type { BusinessTaskV3Dto, RuntimeImageExecutionSnapshot, TaskId } from '@crewstation/contracts';
import { newResourceId } from '@crewstation/kernel';
import { createTestDatabase, testDatabaseAvailable, type TestDatabase } from '@crewstation/testkit';
import { businessTaskMigrations } from '../wiring';
import { taskRecoveryFixture } from './taskRecoveryFixture';
import { executionOperations } from '../adapters/persistence/executionTables';
import { executionTaskStates } from '../adapters/persistence/execution/lifecycleTables';
import { executionLogs } from '../adapters/persistence/execution/projectionTables';
import type { ExecutionLifecycle } from '../domain/executionLifecycle';
import { taskMaterialDigest } from '../domain/executionLifecycle';
import type { ExecutionOperation } from '../domain/taskAdmission';
import type { BusinessExecutionDeps } from '../application/execution/dependencies';
import { recoveryMaterialProof } from '../application/recovery/materialProof';
import { rebuildRecoveryWorkspace } from '../application/recovery/rebuildExecution';

const snapshot = (tag: string, versionId = newResourceId()): RuntimeImageExecutionSnapshot => {
  const digest = `sha256:${tag.repeat(64)}`;
  return { versionId, image: `registry.test/task@${digest}`, digest, architecture: 'linux/amd64', initializer: { steps: [], env: {}, secrets: [] }, tools: [], initializerDigest: digest, validationId: newResourceId(), selectionSource: 'configuration' };
};
const workspace = (image: RuntimeImageExecutionSnapshot) => ({ state: 'failed', persistent: true, stopped: true, activeChildren: false, volumeUid: 'pvc-uid', volumeVerified: true, image: image.image, runtimeImage: image });
function recoveryDeps(taskId: TaskId, pin: RuntimeImageExecutionSnapshot | null, held: Set<string>, rebuilds: unknown[] = []) {
  return {
    lifecycles: { read: async () => ({ generation: 4, state: 'failed', operationId: null, runtimeImage: pin }) },
    runtimeImages: { inspectReference: async (_project: string, owner: { id: string }, image: RuntimeImageExecutionSnapshot) => owner.id === taskId && held.has(image.versionId) },
    recoveryRequests: { forOperation: async () => ({ target: { action: 'rebuild-workspace', taskId, volumeUid: 'pvc-uid' } }) },
    environments: { rebuildBusinessWorkspace: async (input: unknown) => { rebuilds.push(input); return { id: taskId, state: 'creating' }; } },
  };
}

test('material proof compares the workspace with the current pin, not the replaced admission snapshot', async () => {
  const admitted = snapshot('a'), upgraded = snapshot('b'), taskId = newResourceId() as TaskId, held = new Set([upgraded.versionId]);
  const parent = { serviceId: newResourceId(), intent: { projectId: newResourceId(), task: { id: taskId, runtimeImage: admitted } } } as unknown as ExecutionOperation;
  const proof = (pin: RuntimeImageExecutionSnapshot | null, image: RuntimeImageExecutionSnapshot) => recoveryMaterialProof(recoveryDeps(taskId, pin, held) as unknown as BusinessExecutionDeps, parent, workspace(image));
  expect(await proof(upgraded, upgraded)).toEqual({ imageCompatible: true, sessionCompatible: false });
  expect(await proof(upgraded, admitted)).toMatchObject({ imageCompatible: false });
  // Reading the admission snapshot after the upgrade released its reference is the false incompatibility this RFC removes.
  expect(await proof(null, admitted)).toMatchObject({ imageCompatible: false });
  held.add(admitted.versionId);
  expect(await proof(null, admitted)).toMatchObject({ imageCompatible: true });
});

test('rebuild checks the reference of the current pin', async () => {
  const admitted = snapshot('a'), upgraded = snapshot('b'), taskId = newResourceId() as TaskId, rebuilds: unknown[] = [];
  const parent = { serviceId: newResourceId(), intent: { projectId: newResourceId(), task: { id: taskId, runtimeImage: admitted } } };
  const operation = { id: newResourceId(), serviceId: parent.serviceId, taskId, generation: 5 } as unknown as ExecutionLifecycle;
  const deps = (pin: RuntimeImageExecutionSnapshot | null) => ({ ...recoveryDeps(taskId, pin, new Set([upgraded.versionId]), rebuilds), operations: { forTask: async () => parent } }) as unknown as BusinessExecutionDeps;
  expect(await rebuildRecoveryWorkspace(deps(upgraded), operation)).toMatchObject({ state: 'creating' });
  expect(rebuilds).toEqual([{ taskId, projectId: parent.intent.projectId, serviceId: parent.serviceId, operationId: operation.id, generation: 5, volumeUid: 'pvc-uid' }]);
  await expect(rebuildRecoveryWorkspace(deps(null), operation)).rejects.toMatchObject({ details: { code: 'original_image_incompatible' } });
});

const available = await testDatabaseAvailable();
describe.skipIf(!available)('RFC-043 restart after an upgrade', () => {
  let tdb: TestDatabase;
  beforeAll(async () => { tdb = await createTestDatabase([businessTaskMigrations]); });
  afterAll(async () => { await tdb?.drop(); });
  test('a pre-upgrade assessment is stale; restart copies the current pin from the original task', async () => {
    const versionId = newResourceId(), admitted = snapshot('c', versionId), upgraded = snapshot('d');
    const refs = new Set<string>(), copied: string[] = [], inspected: string[] = [];
    const f = await taskRecoveryFixture(tdb.db, { selection: { runtimeImageVersionId: versionId }, port: {
      reserveTask: async (_project, taskId) => { refs.add(`${versionId}:${taskId}`); return admitted; }, confirmTask: async () => {},
      inspectReference: async (_project, owner, image) => { inspected.push(image.versionId); return refs.has(`${image.versionId}:${owner.id}`); },
      restoreTask: async (_project, image, from, to) => { expect(refs.has(`${image.versionId}:${from}`)).toBe(true); refs.add(`${image.versionId}:${to}`); copied.push(`${image.versionId}:${to}`); },
      release: async (image, owner) => { refs.delete(`${image.versionId}:${owner.id}`); },
    } });
    // The upgrade's outcome: the task holds only the new pin's reference.
    f.env.state = 'failed'; f.env.connected = false;
    await tdb.db.update(executionTaskStates).set({ state: 'failed', runtimeImage: upgraded }).where(eq(executionTaskStates.taskId, f.task.id));
    await tdb.db.update(executionLogs).set({ taskState: 'failed' }).where(eq(executionLogs.taskId, f.task.id));
    refs.delete(`${versionId}:${f.task.id}`); refs.add(`${upgraded.versionId}:${f.task.id}`);
    f.environmentPort.restartBusinessWorkspace = async (command) => {
      if (!f.environments.has(command.newTaskId)) f.environments.set(command.newTaskId, { ...f.env, id: command.newTaskId, state: 'creating', connected: false });
      return f.environments.get(command.newTaskId)!;
    };
    const effective = (await tdb.db.select().from(executionOperations).where(eq(executionOperations.serviceId, f.serviceId)))[0]!.effectiveDigest;
    const target = (materialDigest: string) => ({ ...f.admission, request: { ...f.admission.request, requestKey: newResourceId(), target: { taskId: f.task.id, expectedGeneration: 2, materialDigest, action: 'restart-task' as const } } });
    await expect(f.repository.request(target(effective))).rejects.toMatchObject({ details: { code: 'recovery_assessment_stale' } });
    const saved = await f.repository.request(target(taskMaterialDigest(effective, { runtimeImage: upgraded })));
    const claim = (await f.repository.claim(f.serviceId, f.authorization))!;
    const response = await f.request(`/v3/business-tasks/${f.task.id}/restart`, { requestKey: `recovery:${saved.id}`, expectedGeneration: 2, fence: f.fence, recovery: { recoveryRequestId: saved.id, claimId: claim.claimId } });
    expect(response.status).toBe(201);
    const restarted = await response.json() as BusinessTaskV3Dto;
    expect(restarted.runtimeImage).toEqual(upgraded);
    expect(copied).toEqual([`${upgraded.versionId}:${restarted.id}`]);
    expect(inspected.every((id) => id === upgraded.versionId)).toBe(true);
  });
});
