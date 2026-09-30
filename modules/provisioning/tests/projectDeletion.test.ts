import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { PROJECT_DELETION_PHASES, ProjectDeletionOperationSchema, ProjectDeletionPlanSchema } from '@crewstation/contracts';
import { newId, noopLogger } from '@crewstation/kernel';
import { testDatabaseAvailable } from '@crewstation/testkit';
import { projectDeletionController } from '../application/deletion/controller';
import type { DeletionFixture } from './deletionFixture';
import { deletionFixture } from './deletionFixture';

const available = await testDatabaseAvailable(); let f: DeletionFixture;
beforeAll(async () => { if (available) f = await deletionFixture(); });
afterAll(async () => { await f?.database.drop(); });
describe.skipIf(!available)('删除编排（真实 PG＋有状态外部替身）', () => {
  test('缺少或重复 owner 拒绝构造；未登记来源不能开放部分删除', () => {
    for (const owners of [f.external.owners.slice(1), [...f.external.owners, f.external.owners[0]!]]) {
      expect(() => projectDeletionController({ intents: f.intents, owners, workerOwner: 'test', isAdmin: async () => true, enqueue: async () => {}, logger: noopLogger })).toThrow();
    }
  });
  test('盘点来源掉线不解释为空，阻止受理且没有停止／删除副作用', async () => {
    const project = await f.create(); f.external.unavailable.add('data');
    try {
      const plan = await f.controller.prepare(f.admin, project.id); expect(plan.complete).toBe(false);
      expect(plan.blockers).toContainEqual(expect.objectContaining({ participant: 'data', code: 'source-unavailable' }));
      await expect(f.controller.accept(f.admin, project.id, f.input(plan))).rejects.toMatchObject({ kind: 'precondition' });
      expect(f.external.calls.filter((c) => c.projectId === project.id)).toHaveLength(0);
    } finally { f.external.unavailable.delete('data'); }
  });
  test('消费者未停止时只等待，全部 stop 证明之前不调用 purge；恢复后项目根最后清除', async () => {
    const shared = await f.create(), { value, operation } = await f.start(); f.external.waitStop.add('business-task');
    await f.controller.advance(operation.id); const waiting = await f.controller.read(f.admin, operation.id);
    expect(waiting).toMatchObject({ state: 'running', phase: 'stop', canRetry: false });
    expect(waiting.blockers[0]?.code).toBe('waiting-for-proof');
    expect(f.external.calls.some((c) => c.projectId === value.id && c.phase === 'purge')).toBe(false);
    expect((await f.api.getProject(f.admin, value.id)).state).toBe('deleting');
    f.external.waitStop.delete('business-task'); f.elapse(15_001); await f.controller.advance(operation.id);
    const result = await f.controller.read(f.admin, operation.id); expect(result.state).toBe('succeeded');
    expect(result.receipts).toHaveLength(22 * PROJECT_DELETION_PHASES.length);
    await expect(f.api.getProject(f.admin, value.id)).rejects.toMatchObject({ kind: 'not_found' });
    expect((await f.database.db.execute(`SELECT id FROM project.deletion_plans WHERE project_id = '${value.id}'`))).toHaveLength(0);
    expect([...f.external.objects.values()].filter((r) => r.projectId === value.id).every((r) => !r.exists && !r.storage && !r.metadata && !r.running)).toBe(true);
    expect(f.external.state('data', shared.id)).toMatchObject({ exists: true, running: true, storage: true, metadata: true });
  });
  test('副作用完成后丢回执，重试保留前序证明并清完原资源；完成后同请求不重新盘点不存在的根', async () => {
    const { value, request, operation } = await f.start(); f.external.loseReceipt.add('scm');
    await expect(f.controller.advance(operation.id)).rejects.toMatchObject({ kind: 'precondition' });
    expect(f.external.state('scm', value.id).exists).toBe(false);
    const before = await f.controller.read(f.admin, operation.id); expect(before).toMatchObject({ state: 'needs-attention', canRetry: true });
    await f.controller.retry(f.admin, operation.id); await f.controller.advance(operation.id);
    const result = await f.controller.read(f.admin, operation.id); expect(result.state).toBe('succeeded');
    expect(result.receipts.filter((r) => r.phase === 'seal')).toEqual(before.receipts.filter((r) => r.phase === 'seal'));
    expect(await f.controller.accept(f.admin, value.id, request)).toEqual(result);
  });
  test('同名换 UID 阻断且保留替换物；PV 对象消失但后端存储未回收不能进入元数据／根清理', async () => {
    const replaced = await f.start(); f.external.state('resources', replaced.value.id).uid = 'replacement';
    await f.controller.advance(replaced.operation.id);
    expect((await f.controller.read(f.admin, replaced.operation.id)).blockers[0]?.code).toBe('identity-changed');
    expect(f.external.state('resources', replaced.value.id).exists).toBe(true);
    const retained = await f.start(); f.external.retainStorage.add('resources');
    await f.controller.advance(retained.operation.id); const waiting = await f.controller.read(f.admin, retained.operation.id);
    expect(waiting).toMatchObject({ state: 'running', phase: 'prove' });
    expect(f.external.state('resources', retained.value.id)).toMatchObject({ exists: false, storage: true, metadata: true });
    expect(waiting.receipts.some((r) => r.phase === 'namespace' || r.phase === 'metadata')).toBe(false);
    f.external.retainStorage.delete('resources'); f.external.state('resources', retained.value.id).storage = false;
    f.elapse(15_001); await f.controller.advance(retained.operation.id);
    expect((await f.controller.read(f.admin, retained.operation.id)).state).toBe('succeeded');
  });
  test('队列丢受理仍返回持久 202 意图，恢复扫描补队；失去队列心跳后不执行 owner 副作用', async () => {
    f.queueAvailable(false); const { value, operation } = await f.start(); f.queueAvailable(true);
    expect(f.queued).not.toContain(operation.id); await f.controller.recover(); expect(f.queued).toContain(operation.id);
    await expect(f.controller.advance(operation.id, async () => false)).rejects.toMatchObject({ kind: 'precondition' });
    expect(f.external.calls.filter((c) => c.projectId === value.id)).toHaveLength(0);
    expect((await f.controller.read(f.admin, operation.id)).state).toBe('needs-attention');
    await f.controller.retry(f.admin, operation.id); await f.controller.advance(operation.id);
  });
  test('恢复扫描跨过第 100 项，不以第一页或未推进的游标假装扫描完成', async () => {
    const operations = [];
    for (let i = 0; i < 101; i++) operations.push((await f.start()).operation.id);
    f.queued.length = 0; await f.controller.recover();
    for (const id of operations) expect(f.queued).toContain(id);
  }, 30_000);
  test('HTTP 全部路由验证 401／403、严格输入、404、409 和真实盘点／受理／进度／继续成功', async () => {
    const value = await f.create(), planPath = `/v1/projects/${value.id}/deletion-plans`, acceptPath = `/v1/projects/${value.id}/deletions`;
    const missingPath = `/v1/project-deletions/${newId('missing')}`;
    for (const [path, method, body] of [[planPath, 'POST', {}], [acceptPath, 'POST', {}], [missingPath, 'GET', undefined], [`${missingPath}/retry`, 'POST', {}]] as const) {
      expect((await f.call(path, method, body, null)).status).toBe(401);
      expect((await f.call(path, method, body, { ...f.member, isAdmin: true })).status).toBe(403);
    }
    expect((await f.call(planPath, 'POST', { resourceIds: [] })).status).toBe(400);
    const prepared = await f.call(planPath, 'POST', {}); expect(prepared.status).toBe(200); expect(prepared.headers.get('cache-control')).toBe('no-store');
    const plan = ProjectDeletionPlanSchema.parse(await prepared.json()), input = f.input(plan);
    expect((await f.call(acceptPath, 'POST', { ...input, confirm: 'yes' })).status).toBe(400);
    expect((await f.call(missingPath)).status).toBe(404); expect((await f.call(`${missingPath}/retry`, 'POST', {})).status).toBe(404);
    const accepted = await f.call(acceptPath, 'POST', input); expect(accepted.status).toBe(202);
    const operation = ProjectDeletionOperationSchema.parse(await accepted.json()), path = `/v1/project-deletions/${operation.id}`;
    expect(accepted.headers.get('location')).toBe(path);
    expect((await f.call(path)).status).toBe(200); expect((await f.call(`${path}/retry`, 'POST', { skip: true })).status).toBe(400);
    expect((await f.call(`${path}/retry`, 'POST', {})).status).toBe(202);
    expect((await f.call(acceptPath, 'POST', { ...input, requestKey: newId('other') })).status).toBe(409);
    await f.controller.advance(operation.id);
    expect(await (await f.call(path)).json()).toMatchObject({ state: 'succeeded' });
    expect((await f.call(acceptPath, 'POST', input)).status).toBe(202);
    expect((await f.call(acceptPath, 'POST', { ...input, requestKey: newId('other') })).status).toBe(409);
  });
});
