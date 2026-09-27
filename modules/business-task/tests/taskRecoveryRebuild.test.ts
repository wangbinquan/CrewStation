import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { eq, sql } from 'drizzle-orm';
import { newResourceId, quotaExceeded, precondition } from '@crewstation/kernel';
import type { BusinessOperationDto } from '@crewstation/contracts';
import { createTestDatabase, testDatabaseAvailable, type TestDatabase } from '@crewstation/testkit';
import { businessTaskMigrations } from '../wiring';
import { taskRecoveryFixture } from './taskRecoveryFixture';
import { executionTaskStates, executionLifecycles } from '../adapters/persistence/execution/lifecycleTables';
import { executionLogs } from '../adapters/persistence/execution/projectionTables';
import { executionControls } from '../adapters/persistence/executionTables';
import { drizzleExecutionLifecycles } from '../adapters/persistence/execution/lifecycles';

const available = await testDatabaseAvailable();
describe.skipIf(!available)('RFC029 应用恢复失败工作区的持久生命周期', () => {
  let tdb: TestDatabase;
  beforeAll(async () => { tdb = await createTestDatabase([businessTaskMigrations]); });
  afterAll(async () => { await tdb?.drop(); });
  const fixture = async () => {
    const f = await taskRecoveryFixture(tdb.db);
    f.env.state = 'failed'; f.env.connected = false;
    // A prior successful resume can leave a running lifecycle row; actual failed-resource projection wins.
    await tdb.db.update(executionTaskStates).set({ state: 'running' }).where(eq(executionTaskStates.taskId, f.task.id));
    await tdb.db.update(executionLogs).set({ taskState: 'failed' }).where(eq(executionLogs.taskId, f.task.id));
    const saved = await f.repository.request({ ...f.admission, request: { ...f.admission.request, target: { ...f.admission.request.target, action: 'rebuild-workspace', volumeUid: 'original-pvc' } } });
    const claim = (await f.repository.claim(f.serviceId, f.authorization))!;
    const input = { requestKey: `recovery:${saved.id}`, expectedGeneration: 2, fence: f.fence, recovery: { recoveryRequestId: saved.id, claimId: claim.claimId } };
    const received: unknown[] = [], admitted = new Set<string>(), behavior = { quota: false, lost: false, invalidVolume: false };
    f.environmentPort.rebuildBusinessWorkspace = async (command) => {
      received.push(command);
      if (behavior.quota) throw quotaExceeded('full');
      if (behavior.invalidVolume) throw precondition('original volume gone', { code: 'workspace_volume_changed' });
      if (!admitted.has(command.operationId)) { admitted.add(command.operationId); f.env.state = 'creating'; }
      if (behavior.lost) throw new Error('lost rebuild receipt');
      return f.env;
    };
    return { ...f, saved, claim, input, received, admitted, behavior, root: `/v3/business-tasks/${f.task.id}/rebuild` };
  };
  test('失败工作区显式重建；响应丢失和进程重启只沿原操作，新容器连通才完成', async () => {
    const f = await fixture(); f.behavior.lost = true;
    const response = await f.request(f.root, f.input); expect(response.status).toBe(202);
    const operation = await response.json() as BusinessOperationDto;
    expect(f.admitted.size).toBe(1);
    expect(f.received[0]).toEqual({ taskId: f.task.id, serviceId: f.serviceId, projectId: f.projectId, operationId: operation.operationId, generation: 3, volumeUid: 'original-pvc' });
    expect(await f.repository.get(f.serviceId, f.saved.id)).toMatchObject({ state: 'running', operationId: operation.operationId });
    f.behavior.lost = false;
    await f.make().module.api.v3.runOnce();
    expect(await f.repository.get(f.serviceId, f.saved.id)).toMatchObject({ state: 'running' });
    f.env.state = 'running'; f.env.connected = true;
    await f.make().module.api.v3.runOnce();
    expect(await f.repository.get(f.serviceId, f.saved.id)).toMatchObject({ state: 'succeeded' });
    expect((await f.request(f.root, f.input)).status).toBe(202); expect(f.admitted.size).toBe(1);
    expect(await tdb.db.select().from(executionLifecycles).where(eq(executionLifecycles.taskId, f.task.id))).toHaveLength(1);
  });
  test('额度拒绝以同键接续；实际卷变化记录失败；不能用普通resume或伪造请求绕过', async () => {
    const f = await fixture();
    expect((await f.request(f.root, { ...f.input, recovery: undefined })).status).toBe(400);
    expect((await f.request(f.root.replace('/rebuild', '/resume'), f.input)).status).toBe(409);
    expect((await f.request(f.root, { ...f.input, requestKey: newResourceId() })).status).toBe(409);
    expect(f.admitted.size).toBe(0);
    f.behavior.quota = true;
    expect((await f.request(f.root, f.input)).status).toBe(429);
    expect(await f.repository.get(f.serviceId, f.saved.id)).toMatchObject({ state: 'running' });
    f.behavior.quota = false;
    expect((await f.request(f.root, f.input)).status).toBe(202); expect(f.admitted.size).toBe(1);
    f.env.state = 'failed'; f.behavior.invalidVolume = true;
    await f.make().module.api.v3.runOnce();
    expect(await f.repository.get(f.serviceId, f.saved.id)).toMatchObject({ state: 'failed', reason: 'workspace_volume_changed' });
  });
  test('迁移冻结不能把重建当作停止操作派发；当前epoch重新激活才可领取', async () => {
    const f = await fixture(), repository = drizzleExecutionLifecycles(tdb.db);
    const operation = await repository.request(f.serviceId, f.task.id, 'rebuild', f.input, 'failed', f.authorization);
    await tdb.db.update(executionControls).set({ body: sql`body || ${JSON.stringify({ phase: 'frozen', migration: { operationId: newResourceId(), targetReleaseId: newResourceId(), expectedActiveReleaseId: f.releaseId } })}::jsonb` }).where(eq(executionControls.serviceId, f.serviceId));
    expect(await repository.claim('old-worker', operation.id)).toBeUndefined();
    expect(f.received).toHaveLength(0);
    await tdb.db.update(executionControls).set({ body: sql`(body - 'migration') || '{"phase":"active"}'::jsonb` }).where(eq(executionControls.serviceId, f.serviceId));
    expect(await repository.claim('current-worker', operation.id)).toMatchObject({ action: 'rebuild', state: 'running', epoch: f.fence.epoch });
  });
});
