import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import type { BusinessControlDto, BusinessTaskV3Dto, TaskId } from '@crewstation/contracts';
import { newResourceId } from '@crewstation/kernel';
import { createTestDatabase, testDatabaseAvailable } from '@crewstation/testkit';
import type { TestDatabase } from '@crewstation/testkit';
import { drizzleExecutionOperations } from '../adapters/persistence/executionOperations';
import { businessTaskMigrations } from '../wiring';
import { executionHttpFixture } from './executionHttpFixture';

const available = await testDatabaseAvailable(), root = '/v3/business-tasks', controlRoot = '/v3/business-execution/control';
describe.skipIf(!available)('RFC-027 v3 真实 HTTP 与持久受理', () => {
  let tdb: TestDatabase;
  beforeAll(async () => { tdb = await createTestDatabase([businessTaskMigrations]); });
  afterAll(async () => { await tdb?.drop(); });
  const active = async () => {
    const fixture = await executionHttpFixture(tdb.db);
    const instanceId = newResourceId(), claimed = await fixture.request(`${controlRoot}/claim`, { instanceId });
    expect(claimed.status).toBe(200);
    const lease = await claimed.json() as BusinessControlDto;
    const activated = await fixture.request(`${controlRoot}/activate`, { instanceId, expectedEpoch: lease.epoch, leaseId: lease.leaseId, preparationDigest: 'a'.repeat(64) });
    expect(activated.status).toBe(200);
    return { ...fixture, fence: { epoch: lease.epoch, leaseId: lease.leaseId!, instanceId } };
  };

  test('未知字段、缺签名来源、body/header trace 冲突明确拒绝且不准入', async () => {
    const f = await active(), body = { requestKey: 'create', taskContractVersion: 'v1', fence: f.fence };
    const invalid = await f.request(root, { ...body, releaseId: f.releaseId });
    expect(invalid.status).toBe(400); expect(await invalid.json()).toMatchObject({ details: { code: 'unknown_field' } });
    expect((await f.request(root, body, 'forged')).status).toBe(403);
    expect((await f.request(root, body, 'trusted', { 'x-cs-source-service': 'other/other' })).status).toBe(403);
    expect((await f.request(root, { ...body, traceId: 'a'.repeat(32) }, 'trusted', { 'x-cs-trace-id': 'b'.repeat(32) })).status).toBe(400);
    expect(f.behavior.starts).toBe(0);
    expect(await drizzleExecutionOperations(tdb.db).find({ serviceId: f.serviceId, parentId: '', kind: 'create-task', requestKey: 'create' })).toBeUndefined();
  });

  test('首次 201、重复 200：并发和重建模块仍是同任务、原 trace 和固定 defaults；GET 不启动执行', async () => {
    const f = await active(), body = { requestKey: 'one', taskContractVersion: 'v1', fence: f.fence };
    const responses = await Promise.all(Array.from({ length: 8 }, () => f.request(root, body, 'trusted', { 'x-cs-trace-id': 'a'.repeat(32) })));
    const tasks = await Promise.all(responses.map((response) => response.json() as Promise<BusinessTaskV3Dto>));
    expect(new Set(tasks.map((task) => task.id)).size).toBe(1);
    expect(f.behavior.starts).toBe(1);
    const task = tasks[0]!;
    expect(task).toMatchObject({ releaseId: f.releaseId, traceId: 'a'.repeat(32), volumeMode: 'persistent', taskProfileId: f.taskProfileId });
    const restarted = f.make();
    const replay = await restarted.request(root, body, 'trusted', { 'x-cs-trace-id': 'b'.repeat(32) });
    expect(replay.status).toBe(200); expect(await replay.json()).toEqual(task);
    const changed = await restarted.request(root, { ...body, volumeMode: 'follow-container' });
    expect(changed.status).toBe(409); expect(await changed.json()).toMatchObject({ details: { code: 'idempotency_conflict' } });
    const before = f.behavior.starts;
    expect((await restarted.request(`${root}/${task.id}`)).status).toBe(200);
    expect(f.behavior.starts).toBe(before);
  });

  test('额度满返回 429 和 Retry-After，不被后台排队；同键显式重试保留 taskId', async () => {
    const f = await active(), body = { requestKey: 'capacity', taskContractVersion: 'v1', fence: f.fence };
    f.behavior.quota = true;
    const rejected = await f.request(root, body);
    expect(rejected.status).toBe(429); expect(rejected.headers.get('retry-after')).toBe('1');
    const operation = (await drizzleExecutionOperations(tdb.db).find({ serviceId: f.serviceId, kind: 'create-task', parentId: '', requestKey: 'capacity' }))!;
    f.behavior.quota = false;
    await f.module.api.v3.runOnce(); expect(f.behavior.starts).toBe(0);
    const retry = await f.request(root, body);
    expect(retry.status).toBe(200); expect(await retry.json()).toMatchObject({ id: operation.intent.task.id, state: 'creating' });
    expect(f.behavior.starts).toBe(1);
  });

  test('未知准入返回 202 原句柄，查询只读；新模块后台恢复，不依赖浏览器轮询', async () => {
    const f = await active(), body = { requestKey: 'unknown', taskContractVersion: 'v1', fence: f.fence };
    f.behavior.unknown = true;
    const accepted = await f.request(root, body); expect(accepted.status).toBe(202);
    const task = await accepted.json() as BusinessTaskV3Dto;
    expect(task).toMatchObject({ state: 'admitting', resourceState: 'unknown', quotaHeld: null });
    f.behavior.unknown = false;
    expect((await f.request(`${root}/${task.id}`)).status).toBe(200); expect(f.behavior.starts).toBe(0);
    await f.make().module.api.v3.runOnce();
    expect(f.environments.has(task.id as TaskId)).toBe(true); expect(f.behavior.starts).toBe(1);
    expect(await (await f.request(`${root}/${task.id}`)).json()).toMatchObject({ state: 'creating', quotaHeld: true });
  });

  test('准备租约没有派发权；租约释放后旧请求不能创建新任务，但可读已受理回执', async () => {
    const f = await active(), input = { requestKey: 'existing', taskContractVersion: 'v1', fence: f.fence };
    const first = await f.request(root, input); expect(first.status).toBe(201);
    const task = await first.json() as BusinessTaskV3Dto;
    const released = await f.request(`${controlRoot}/release`, { expectedEpoch: f.fence.epoch, leaseId: f.fence.leaseId, instanceId: f.fence.instanceId });
    expect(released.status).toBe(200);
    expect((await f.request(root, { ...input, requestKey: 'new' })).status).toBe(409);
    const receipt = await f.request(root, input); expect(receipt.status).toBe(200); expect(await receipt.json()).toEqual(task);
    expect(f.behavior.starts).toBe(1);
  });
});
