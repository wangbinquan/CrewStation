import { afterEach, describe, expect, test } from 'bun:test';
import type { Actor, TaskId, UserId } from '@crewstation/contracts';
import { BusinessExecutionTaskPageSchema, BusinessSubtaskV3DtoSchema } from '@crewstation/contracts';
import { createApp } from '@crewstation/http';
import { userRoutes } from '../http/userRoutes';
import { newResourceId } from '@crewstation/kernel';
import { createTestDatabase, testDatabaseAvailable, type TestDatabase } from '@crewstation/testkit';
import { eq, sql } from 'drizzle-orm';
import { drizzleBusinessTaskList } from '../adapters/persistence/task-list/repository';
import { tasks, subtasks } from '../adapters/persistence/tables';
import { executionSubtasks } from '../adapters/persistence/execution/subtaskTables';
import { taskListUseCases } from '../application/taskList';
import { businessTaskMigrations } from '../wiring';
import { executionHttpFixture } from './executionHttpFixture';

const available = await testDatabaseAvailable();
describe.skipIf(!available)('管理员任务列表跨协议排序、分页与恢复边界', () => {
  let tdb: TestDatabase;
  afterEach(async () => { await tdb?.drop(); });
  const setup = async () => {
    tdb = await createTestDatabase([businessTaskMigrations]); const f = await executionHttpFixture(tdb.db);
    const list = drizzleBusinessTaskList(tdb.db), actor: Actor = { userId: newResourceId() as UserId, isAdmin: true };
    const insert = async (state = 'running', date = '2026-09-27T10:00:00Z', projectId = f.projectId) => {
      const id = newResourceId() as TaskId;
      await tdb.db.insert(tasks).values({ id, projectId, serviceId: f.serviceId, callerIdentity: 'demo/demo', state, traceId: 'a'.repeat(32), volumeMode: 'persistent', profile: f.taskProfileId, labels: { name: 'visible task' }, createdAt: new Date(date), updatedAt: new Date(date) }); return id;
    };
    return { ...f, list, actor, insert };
  };
  test('旧失败在超过100个新任务之前；稳定游标无重复，项目过滤在分页前；禁止非管理员', async () => {
    const f = await setup(); const failed = await f.insert('failed', '2020-01-01T00:00:00Z');
    for (let i = 0; i < 105; i++) await f.insert();
    const extra = await f.insert('failed', '2026-09-28T00:00:00Z', newResourceId() as typeof f.projectId);
    const page = await f.list.list({ projectId: f.projectId, limit: 30 }); expect(page.items[0]?.id).toBe(failed); expect(page.items[0]?.attention).toBe('failed');
    const seen = page.items.map((i) => i.id); let next = page.next;
    while (next) { const p = await f.list.list({ projectId: f.projectId, limit: 30, cursor: next }); seen.push(...p.items.map((i) => i.id)); next = p.next; }
    expect(seen).toHaveLength(106); expect(new Set(seen).size).toBe(106); expect(seen).not.toContain(extra);
    await expect(f.list.list({ cursor: page.next })).rejects.toMatchObject({ kind: 'validation' });
    await expect(f.list.list({ cursor: 'not-json' })).rejects.toMatchObject({ kind: 'validation' });
    let called = false;
    await expect(taskListUseCases({ list: async () => { called = true; return { items: [] }; } }).listExecutionTasks({ ...f.actor, isAdmin: false }, {})).rejects.toMatchObject({ kind: 'forbidden' });
    expect(called).toBe(false);
  });
  test('v3无投影明确未知；未解决子任务失败置顶，成功重试保留历史但清除失败摘要；查询无写副作用', async () => {
    const f = await setup(), instanceId = newResourceId();
    const control = await (await f.request('/v3/business-execution/control/claim', { instanceId })).json() as { epoch: number; leaseId: string };
    await f.request('/v3/business-execution/control/activate', { instanceId, expectedEpoch: control.epoch, leaseId: control.leaseId, preparationDigest: 'a'.repeat(64) });
    const response = await f.request('/v3/business-tasks', { requestKey: 'list-test', taskContractVersion: 'v1', fence: { epoch: control.epoch, leaseId: control.leaseId, instanceId } });
    expect(response.status).toBe(201); const task = await response.json() as { id: TaskId };
    const initial = await f.list.list({}); expect(initial.items[0]).toMatchObject({ id: task.id, protocol: 'v3', state: 'unknown', attention: 'unknown' });
    const old = await f.insert(), child = newResourceId();
    await tdb.db.insert(subtasks).values({ id: child, taskId: old, name: 'failing step', kind: 'command', state: 'failed', attempt: 1, spec: { secret: 'never-select-this' }, error: 'exit 1', createdAt: new Date() });
    let page = await f.list.list({}); expect(page.items[0]).toMatchObject({ id: old, failedSubtasks: 1, latestFailure: { id: child, name: 'failing step', state: 'failed', message: 'exit 1' } });
    expect(JSON.stringify(page)).not.toContain('never-select-this');
    await tdb.db.insert(subtasks).values({ id: newResourceId(), taskId: old, name: 'retry', kind: 'command', state: 'succeeded', attempt: 2, retryOf: child, spec: {}, createdAt: new Date() });
    page = await f.list.list({}); expect(page.items.find((i) => i.id === old)).toMatchObject({ attention: 'none', failedSubtasks: 0 });
    const id = newResourceId(), view = { id, taskId: task.id, name: 'lost agent', kind: 'agent', state: 'running', process: 'unknown', executionId: newResourceId(), attempt: 1, createdAt: new Date().toISOString() };
    await tdb.db.insert(executionSubtasks).values({ id, taskId: task.id, serviceId: f.serviceId, requestKey: 'unknown', requestDigest: 'a', sealedPayload: 'never-select-sealed', payloadDigest: 'b', fenced: true, view: BusinessSubtaskV3DtoSchema.parse(view), dispatch: 'unknown', updatedAt: new Date() });
    const before = await tdb.db.execute(sql`SELECT count(*) AS n FROM business_task.execution_events`);
    const unknown = await f.list.list({}); expect(unknown.items.find((i) => i.id === task.id)).toMatchObject({ unknownSubtasks: 1, latestFailure: { name: 'lost agent', state: 'unknown' } });
    expect(JSON.stringify(unknown)).not.toContain('never-select-sealed'); expect(BusinessExecutionTaskPageSchema.safeParse(unknown).success).toBe(true);
    expect(await tdb.db.execute(sql`SELECT count(*) AS n FROM business_task.execution_events`)).toEqual(before);
    await tdb.db.update(executionSubtasks).set({ view: BusinessSubtaskV3DtoSchema.parse({ ...view, state: 'failed', process: 'exited' }), dispatch: 'accepted' }).where(eq(executionSubtasks.id, id));
    expect((await f.list.list({})).items.find((i) => i.id === task.id)).toMatchObject({ attention: 'failed', failedSubtasks: 1, unknownSubtasks: 0 });
  });
  test('HTTP管理员授权与严格筛选校验，未登录和普通用户不能枚举其他项目', async () => {
    const f = await setup(); await f.insert();
    const app = createApp({ name: 'task-list' }); app.route('/', userRoutes(f.module.api, async (id) => id === f.actor.userId));
    const path = '/v1/admin/business-execution/tasks';
    expect((await app.request(path)).status).toBe(401);
    expect((await app.request(path, { headers: { 'x-cs-user-id': newResourceId() } })).status).toBe(403);
    const headers = { 'x-cs-user-id': f.actor.userId };
    expect((await app.request(path + '?limit=101', { headers })).status).toBe(400);
    expect((await app.request(path + '?extra=ignored', { headers })).status).toBe(400);
    const response = await app.request(path + '?projectId=' + f.projectId + '&limit=1', { headers });
    expect(response.status).toBe(200); expect(BusinessExecutionTaskPageSchema.parse(await response.json()).items).toHaveLength(1);
  });

  test('状态筛选在分页前生效，失败含子步骤失败；换筛选不能复用旧游标', async () => {
    const f = await setup();
    const failed = await f.insert('failed'), paused = await f.insert('paused'), running = await f.insert();
    await tdb.db.insert(subtasks).values({ id: newResourceId(), taskId: running, name: '失败步骤', kind: 'command', state: 'failed', attempt: 1, spec: {}, createdAt: new Date() });
    const first = await f.list.list({ state: 'failed', limit: 1 }); expect(first.items).toHaveLength(1); expect(first.next).toBeDefined();
    const second = await f.list.list({ state: 'failed', limit: 1, cursor: first.next });
    expect(new Set([...first.items, ...second.items].map((i) => i.id))).toEqual(new Set([failed, running]));
    expect((await f.list.list({ state: 'paused' })).items.map((i) => i.id)).toEqual([paused]);
    expect((await f.list.list({ state: 'running' })).items.map((i) => i.id)).toEqual([running]);
    expect((await f.list.list({ state: 'unknown' })).items).toHaveLength(0);
    expect((await f.list.list({ state: 'closed' })).items).toHaveLength(0);
    await expect(f.list.list({ state: 'paused', cursor: first.next })).rejects.toMatchObject({ kind: 'validation' });
  });
});
