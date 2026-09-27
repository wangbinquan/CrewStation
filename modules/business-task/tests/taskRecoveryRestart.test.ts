import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { and, eq, sql } from 'drizzle-orm';
import type { BusinessTaskV3Dto, RuntimeImageExecutionSnapshot, TaskId } from '@crewstation/contracts';
import { newResourceId, quotaExceeded, precondition } from '@crewstation/kernel';
import { createTestDatabase, testDatabaseAvailable, type TestDatabase } from '@crewstation/testkit';
import { businessTaskMigrations } from '../wiring';
import { taskRecoveryFixture } from './taskRecoveryFixture';
import { executionOperations } from '../adapters/persistence/executionTables';
import { executionTaskStates } from '../adapters/persistence/execution/lifecycleTables';
import { executionLogs } from '../adapters/persistence/execution/projectionTables';
import { contracts } from '../adapters/persistence/tables';
import { executionControls } from '../adapters/persistence/executionTables';

const available = await testDatabaseAvailable();
describe.skipIf(!available)('RFC029 原任务材料重新执行与新任务关联', () => {
  let tdb: TestDatabase;
  beforeAll(async () => { tdb = await createTestDatabase([businessTaskMigrations]); });
  afterAll(async () => { await tdb?.drop(); });
  const fixture = async (images?: Parameters<typeof taskRecoveryFixture>[1]) => {
    const f = await taskRecoveryFixture(tdb.db, images);
    f.env.state = 'failed'; f.env.connected = false;
    await tdb.db.update(executionTaskStates).set({ state: 'failed' }).where(eq(executionTaskStates.taskId, f.task.id));
    await tdb.db.update(executionLogs).set({ taskState: 'failed' }).where(eq(executionLogs.taskId, f.task.id));
    const saved = await f.repository.request({ ...f.admission, request: { ...f.admission.request, target: { taskId: f.task.id, expectedGeneration: 2, materialDigest: f.admission.request.target.materialDigest, action: 'restart-task' } } });
    const claim = (await f.repository.claim(f.serviceId, f.authorization))!;
    const input = { requestKey: `recovery:${saved.id}`, expectedGeneration: 2, fence: f.fence, recovery: { recoveryRequestId: saved.id, claimId: claim.claimId } };
    const behavior = { quota: false, lost: false }, received: unknown[] = [];
    f.environmentPort.restartBusinessWorkspace = async (command) => {
      received.push(command);
      if (behavior.quota) throw quotaExceeded('full');
      if (!f.environments.has(command.newTaskId)) f.environments.set(command.newTaskId, { ...f.env, id: command.newTaskId, state: 'creating', connected: false });
      if (behavior.lost) throw new Error('lost reply');
      return f.environments.get(command.newTaskId)!;
    };
    return { ...f, saved, input, restartBehavior: behavior, received, root: `/v3/business-tasks/${f.task.id}/restart` };
  };
  test('同一恢复只创建一个关联任务，保留原契约和旧失败记录，启动后才完成恢复请求', async () => {
    const f = await fixture(); f.restartBehavior.lost = true;
    const response = await f.request(f.root, f.input); expect(response.status).toBe(201);
    const task = await response.json() as BusinessTaskV3Dto;
    expect(task.id).not.toBe(f.task.id); expect(task.releaseId).toBe(f.task.releaseId);
    expect(task.contractDigest).toBe(f.task.contractDigest); expect(task.taskProfileId).toBe(f.task.taskProfileId);
    expect(task.generation).toBe(1); expect(task.state).toBe('creating');
    expect(await f.repository.get(f.serviceId, f.saved.id)).toMatchObject({ state: 'running', resultTaskId: task.id });
    f.restartBehavior.lost = false;
    const replay = await f.make().request(f.root, f.input); expect(replay.status).toBe(200);
    expect((await replay.json() as BusinessTaskV3Dto).id).toBe(task.id);
    await f.make().module.api.v3.runOnce();
    expect(await f.repository.get(f.serviceId, f.saved.id)).toMatchObject({ state: 'running' });
    const env = f.environments.get(task.id)!; env.state = 'running'; env.connected = true;
    await f.make().module.api.v3.runOnce();
    expect(await f.repository.get(f.serviceId, f.saved.id)).toMatchObject({ state: 'succeeded', resultTaskId: task.id });
    expect(f.env.state).toBe('failed');
    const rows = await tdb.db.select().from(executionOperations).where(and(eq(executionOperations.serviceId, f.serviceId), eq(executionOperations.parentId, f.task.id)));
    expect(rows).toHaveLength(1); expect(rows[0]!.intent.restartOf).toEqual({ taskId: f.task.id, expectedGeneration: 2 });
    expect(f.environmentInputs).toHaveLength(1); // Restart never goes through current-default createEnvironment.
    expect(f.received).toHaveLength(1);
  });
  test('缺少恢复认领、变更目标或原键均拒绝；额度拒绝同键接续，启动失败保留失败原因', async () => {
    const f = await fixture();
    expect((await f.request(f.root, { ...f.input, recovery: undefined })).status).toBe(400);
    expect((await f.request(f.root, { ...f.input, requestKey: 'different' })).status).toBe(409);
    expect((await f.request(f.root, { ...f.input, expectedGeneration: 3 })).status).toBe(409);
    expect(f.received).toHaveLength(0);
    f.restartBehavior.quota = true;
    expect((await f.request(f.root, f.input)).status).toBe(429);
    const accepted = await f.repository.get(f.serviceId, f.saved.id);
    expect(accepted).toMatchObject({ state: 'running' }); expect(accepted!.resultTaskId).toBeDefined();
    f.restartBehavior.quota = false;
    const response = await f.request(f.root, f.input); expect(response.status).toBe(200);
    const task = await response.json() as BusinessTaskV3Dto; expect(task.id).toBe(accepted!.resultTaskId!);
    f.environments.get(task.id)!.state = 'failed';
    await f.make().module.api.v3.runOnce();
    expect(await f.repository.get(f.serviceId, f.saved.id)).toMatchObject({ state: 'failed', reason: 'restarted_task_failed', resultTaskId: task.id });
    expect(f.env.state).toBe('failed');
  });
  test('并发重启复制原镜像引用而非重新选择，当前默认变化不修改原材料', async () => {
    const digest = `sha256:${'c'.repeat(64)}`;
    const snapshot: RuntimeImageExecutionSnapshot = { versionId: newResourceId(), image: `registry.test/original@${digest}`, digest, architecture: 'linux/amd64', initializer: { steps: [], env: {}, secrets: [] }, tools: [], initializerDigest: digest, validationId: newResourceId(), selectionSource: 'configuration' };
    const refs = new Set<TaskId>(), copied: TaskId[] = [], released: TaskId[] = [], inspected: TaskId[] = [];
    let selections = 0;
    const f = await fixture({ selection: { runtimeImageVersionId: snapshot.versionId }, port: {
      reserveTask: async (_project, taskId) => { selections++; refs.add(taskId); return snapshot; }, confirmTask: async (_s, id) => { expect(refs.has(id)).toBe(true); },
      inspectReference: async (_project, owner, actual) => { inspected.push(owner.id); expect(actual).toEqual(snapshot); return refs.has(owner.id); },
      restoreTask: async (_project, actual, from, to) => { expect(actual).toEqual(snapshot); expect(refs.has(from)).toBe(true); refs.add(to); copied.push(to); },
      release: async (_s, owner) => { refs.delete(owner.id); released.push(owner.id); },
    } });
    await tdb.db.update(contracts).set({ tasksSpec: sql`tasks_spec || ${JSON.stringify({ taskProfileId: newResourceId(), runtimeImageVersionId: newResourceId() })}::jsonb` }).where(eq(contracts.releaseId, f.releaseId));
    const responses = await Promise.all([f.request(f.root, f.input), f.make().request(f.root, f.input)]);
    expect(responses.every((r) => [200, 201, 202].includes(r.status))).toBe(true);
    const views = await Promise.all(responses.map((r) => r.json() as Promise<BusinessTaskV3Dto>));
    expect(views[0]!.id).toBe(views[1]!.id); expect(views[0]!.runtimeImage).toEqual(snapshot);
    expect(views[0]!.taskProfileId).toBe(f.task.taskProfileId); expect(selections).toBe(1);
    expect(refs.has(f.task.id)).toBe(true); expect(refs.has(views[0]!.id)).toBe(true);
    expect(refs.size).toBe(2); expect(copied.length - released.length).toBe(1);
    expect(inspected.every((id) => id === f.task.id)).toBe(true);
  });
  test('当前应用不接受旧任务契约时拒绝；未派发操作冻结后只能由当前执行权接续', async () => {
    const f = await fixture();
    await tdb.db.update(contracts).set({ tasksSpec: sql`tasks_spec || '{"acceptedTaskContractVersions":["v2"]}'::jsonb` }).where(eq(contracts.releaseId, f.releaseId));
    expect((await f.request(f.root, f.input)).status).toBe(412); expect(f.received).toHaveLength(0);
    await tdb.db.update(contracts).set({ tasksSpec: sql`tasks_spec || '{"acceptedTaskContractVersions":["v1"]}'::jsonb` }).where(eq(contracts.releaseId, f.releaseId));
    f.restartBehavior.quota = true; expect((await f.request(f.root, f.input)).status).toBe(429);
    const recovery = (await f.repository.get(f.serviceId, f.saved.id))!;
    await tdb.db.update(executionOperations).set({ state: 'pending', errorCode: null }).where(eq(executionOperations.id, recovery.operationId!));
    await tdb.db.update(executionControls).set({ body: sql`body || '{"phase":"frozen"}'::jsonb` }).where(eq(executionControls.serviceId, f.serviceId));
    f.restartBehavior.quota = false; await f.make().module.api.v3.runOnce(); expect(f.received).toHaveLength(1);
    expect((await f.request(f.root, f.input)).status).toBe(409);
    await tdb.db.update(executionControls).set({ body: sql`body || '{"phase":"active"}'::jsonb` }).where(eq(executionControls.serviceId, f.serviceId));
    expect((await f.request(f.root, f.input)).status).toBe(200); expect(f.received).toHaveLength(2);
  });
  test('运行时明确拒绝启动时记录实际失败，不将新任务准入当作完成', async () => {
    const f = await fixture();
    f.environmentPort.restartBusinessWorkspace = async () => { throw precondition('original no longer stopped', { code: 'workspace_changed' }); };
    expect((await f.request(f.root, f.input)).status).toBe(412);
    await f.make().module.api.v3.runOnce();
    expect(await f.repository.get(f.serviceId, f.saved.id)).toMatchObject({ state: 'failed', reason: 'workspace_changed' });
    expect(f.environments.size).toBe(1);
  });
  test('同键不能修改原目标；认领或运行能力缺失不能静默走普通新建', async () => {
    const f = await fixture();
    const first = await f.request(f.root, f.input); expect(first.status).toBe(201);
    expect((await f.request(f.root, { ...f.input, expectedGeneration: 3 })).status).toBe(409);
    const other = await fixture(); other.environmentPort.restartBusinessWorkspace = undefined;
    expect((await other.request(other.root, other.input)).status).toBe(412);
    await other.make().module.api.v3.runOnce();
    expect(await other.repository.get(other.serviceId, other.saved.id)).toMatchObject({ state: 'failed', reason: 'unsupported_capability' });
    expect(other.environmentInputs).toHaveLength(1);
  });
});
