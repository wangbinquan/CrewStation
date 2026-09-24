import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import type { Actor, ResourceActionId } from '@crewstation/contracts';
import { IDENTITY_HEADERS, ResourceRecordSchema, ResourceViewSchema } from '@crewstation/contracts';
import { createApp } from '@crewstation/http';
import { isPlatformError } from '@crewstation/kernel';
import { testDatabaseAvailable } from '@crewstation/testkit';
import type { Harness } from './fixtures';
import { ADMIN, createHarness, DEVELOPER, execution, OTHER_PROJECT, OUTSIDER, pod, PROJECT, TESTER, workspace } from './fixtures';

const available = await testDatabaseAvailable();

async function failure(promise: Promise<unknown>): Promise<{ kind: string; message: string; details: Record<string, unknown> }> {
  try { await promise; } catch (error) { if (isPlatformError(error)) return { kind: error.kind, message: error.message, details: error.details }; throw error; }
  throw new Error('expected rejection');
}

describe.skipIf(!available)('标准资源视图（RFC-025 设计 §4）', () => {
  let h: Harness;
  let workspaceId: string;
  let stoppedId: string;
  beforeAll(async () => {
    h = await createHarness();
    const ledger = h.module.api.owner('task-runtime');
    const ws = await ledger.declare(workspace('v1'));
    workspaceId = ws.id;
    await h.module.api.observe({ child: pod('task-v1', { uid: 'uid-v1' }) });
    await ledger.report(ws.id, { conditions: [{ type: 'RunnerConnected', status: 'true' }] });
    await ledger.declare(execution('v1-cli', ws.id));
    const done = await ledger.declare(execution('v1-old', ws.id));
    stoppedId = (await ledger.requestRelease(done.id, { code: 'user', message: '结束 CLI' })).id;
    await ledger.declare({ ...workspace('elsewhere'), projectId: OTHER_PROJECT, spec: { children: [] } });
  });
  afterAll(async () => { await h.database.drop(); });

  test('项目视图：只给在运行的；计数按种类 × 阶段算好；游标是快照时刻的变更序号；记录符合契约', async () => {
    const view = await h.module.api.view(DEVELOPER, PROJECT, {});
    expect(ResourceViewSchema.parse(view)).toBeTruthy();
    expect(view.items.map((item) => item.owner.ref)).toEqual(['v1', 'v1-cli']);
    expect(view.counts).toEqual({ 'dev-workspace': { ready: 1 }, 'agent-execution': { provisioning: 1 } });
    expect(view.cursor).toBeGreaterThan(0);
    const ws = view.items[0]!;
    expect(ResourceRecordSchema.parse(ws)).toMatchObject({ phase: 'ready', display: { branch: 'main' }, children: [{ name: 'task-v1', uid: 'uid-v1', phase: 'Running' }] });
    expect(ws.actions).toEqual([{ id: 'release', enabled: true }, { id: 'retry', enabled: false, disabledReason: '只有失败的才可以重试' }]);
  });

  test('过滤：按种类、按上级；带上已结束的', async () => {
    expect((await h.module.api.view(DEVELOPER, PROJECT, { kind: 'agent-execution' })).items.map((i) => i.owner.ref)).toEqual(['v1-cli']);
    expect((await h.module.api.view(DEVELOPER, PROJECT, { parent: workspaceId, includeStopped: 'true' })).items.map((i) => i.id)).toContain(stoppedId);
  });

  test('只读成员看得到但操作不可用；不是成员被拒；管理员视图只给管理员，并能跨项目', async () => {
    const tester = await h.module.api.view(TESTER, PROJECT, {});
    expect(tester.items[0]?.actions[0]).toEqual({ id: 'release', enabled: false, disabledReason: '需要这个项目的开发权限' });
    expect((await failure(h.module.api.view(OUTSIDER, PROJECT, {}))).kind).toBe('forbidden');
    expect((await failure(h.module.api.adminView(DEVELOPER, {}))).kind).toBe('forbidden');
    const all = await h.module.api.adminView(ADMIN, {});
    expect(all.items.map((i) => i.owner.ref).sort()).toEqual(['elsewhere', 'v1', 'v1-cli']);
    expect((await h.module.api.adminView(ADMIN, { projectId: OTHER_PROJECT })).items.map((i) => i.owner.ref)).toEqual(['elsewhere']);
  });
});

describe.skipIf(!available)('可做操作的统一受理（设计 §4.2）', () => {
  let h: Harness;
  const calls: { actor: Actor; action: ResourceActionId; id: string }[] = [];
  beforeAll(async () => {
    h = await createHarness();
    h.module.api.registerActionHandler('task-runtime', async ({ actor, record, action }) => {
      calls.push({ actor, action, id: record.id });
      if (action === 'release') await h.module.api.owner('task-runtime').requestRelease(record.id, { code: 'user', message: `${actor.userId} 释放` });
    });
  });
  afterAll(async () => { await h.database.drop(); });

  test('受理后转给所属模块执行，结果回到同一条记录', async () => {
    const ws = await h.module.api.owner('task-runtime').declare(workspace('x1'));
    await h.module.api.observe({ child: pod('task-x1', { uid: 'uid-x1' }) });
    const result = await h.module.api.performAction(DEVELOPER, ws.id, 'release', { expectedVersion: 2 });
    expect(result).toMatchObject({ accepted: true, record: { id: ws.id, phase: 'stopping' } });
    expect(calls).toEqual([{ actor: DEVELOPER, action: 'release', id: ws.id }]);
  });

  test('拒绝：没有开发权限 403；前置条件不满足 412 带原因码；版本对不上 409；这类资源没有这个操作；所属模块没登记执行者', async () => {
    const ws = await h.module.api.owner('task-runtime').declare(workspace('x2'));
    expect((await failure(h.module.api.performAction(TESTER, ws.id, 'release', {}))).kind).toBe('forbidden');
    expect((await failure(h.module.api.performAction(OUTSIDER, ws.id, 'release', {}))).kind).toBe('forbidden');
    expect(await failure(h.module.api.performAction(DEVELOPER, ws.id, 'retry', {}))).toMatchObject({ kind: 'precondition', message: '只有失败的才可以重试', details: { code: 'action-disabled' } });
    expect(await failure(h.module.api.performAction(DEVELOPER, ws.id, 'release', { expectedVersion: 99 }))).toMatchObject({ kind: 'conflict' });
    expect(await failure(h.module.api.performAction(DEVELOPER, ws.id, 'delete-volume', {}))).toMatchObject({ kind: 'precondition', details: { code: 'action-unsupported' } });
    const cli = await h.module.api.owner('dev-session').declare(execution('x2-cli', ws.id));
    expect(await failure(h.module.api.performAction(DEVELOPER, cli.id, 'release', {}))).toMatchObject({ kind: 'precondition', message: '这类资源暂不支持在这里操作' });
    expect((await failure(h.module.api.performAction(DEVELOPER, '01a0bf5d-8f4b-7c01-8e19-e226732a7599', 'release', {}))).kind).toBe('not_found');
  });

  test('工作卷的删除只给管理员', async () => {
    const volume = await h.module.api.owner('task-runtime').declare({ kind: 'volume', ref: 'x3-work', projectId: PROJECT, spec: { children: [] } });
    expect((await h.module.api.view(DEVELOPER, PROJECT, { kind: 'volume' })).items[0]?.actions).toEqual([{ id: 'delete-volume', enabled: false, disabledReason: '只有管理员可以删除工作卷' }]);
    expect((await h.module.api.view(ADMIN, PROJECT, { kind: 'volume' })).items[0]?.actions[0]?.disabledReason).toBe('只有待回收的工作卷可以删除');
    expect((await failure(h.module.api.performAction(ADMIN, volume.id, 'delete-volume', {}))).message).toBe('只有待回收的工作卷可以删除');
  });

  // 设计 §6.4、D8：待回收的工作卷由管理员确认后删——资源中心自己受理（不交所属模块），期望改为「不要了」，调和器随之删 PVC。
  test('待回收的工作卷：管理员删除即「不要了」（原因写明，以所属模块的名义），此后不能再删；非管理员与版本已变的拒绝', async () => {
    const pvc = { kind: 'PersistentVolumeClaim', namespace: 'cs-demo', name: 'orphan-work' };
    const volume = await h.module.api.owner('cluster-control').declare({ kind: 'volume', ref: 'orphan-work', projectId: PROJECT, spec: { children: [pvc] } });
    await h.module.api.observeConditions(volume.id, [{ type: 'PendingReclaim', status: 'true', reason: 'orphaned', message: '孤儿工作卷，等管理员确认' }]);
    const pending = await h.module.api.get(volume.id);
    expect((await failure(h.module.api.performAction(DEVELOPER, volume.id, 'delete-volume', {}))).kind).toBe('forbidden');
    expect((await failure(h.module.api.performAction(ADMIN, volume.id, 'delete-volume', { expectedVersion: pending!.version + 1 }))).kind).toBe('conflict');
    const result = await h.module.api.performAction(ADMIN, volume.id, 'delete-volume', { expectedVersion: pending!.version });
    expect(result.accepted).toBe(true);
    expect(await h.module.api.get(volume.id)).toMatchObject({ desired: 'absent', owner: { module: 'cluster-control' }, releaseReason: { code: 'volume-deleted', message: '管理员确认删除工作卷' } });
    expect(result.record?.actions).toEqual([{ id: 'delete-volume', enabled: false, disabledReason: '已受理删除，正在回收' }]);
    expect((await failure(h.module.api.performAction(ADMIN, volume.id, 'delete-volume', {}))).message).toBe('已受理删除，正在回收');
  });
});

describe.skipIf(!available)('HTTP 路由', () => {
  let h: Harness;
  let app: ReturnType<typeof createApp>;
  const as = (actor: Actor) => ({ [IDENTITY_HEADERS.userId]: actor.userId, [IDENTITY_HEADERS.userName]: 'n', [IDENTITY_HEADERS.userEmail]: 'e@x' });
  beforeAll(async () => {
    h = await createHarness();
    app = createApp({ name: 'resources-test' });
    for (const router of h.module.http) app.route('/', router);
    h.module.api.registerActionHandler('task-runtime', async ({ record }) => { await h.module.api.owner('task-runtime').requestRelease(record.id, { code: 'user', message: '释放' }); });
    await h.module.api.owner('task-runtime').declare(workspace('http1'));
  });
  afterAll(async () => { await h.database.drop(); });

  test('项目视图：200 给标准视图；未登录 401；不是成员 403；查询参数不合法 400', async () => {
    const ok = await app.request(`/v1/projects/${PROJECT}/resources?kind=dev-workspace`, { headers: as(DEVELOPER) });
    expect(ok.status).toBe(200);
    expect(ResourceViewSchema.parse(await ok.json()).items.map((i) => i.owner.ref)).toEqual(['http1']);
    expect((await app.request(`/v1/projects/${PROJECT}/resources`)).status).toBe(401);
    expect((await app.request(`/v1/projects/${PROJECT}/resources`, { headers: as(OUTSIDER) })).status).toBe(403);
    expect((await app.request(`/v1/projects/${PROJECT}/resources?kind=nope`, { headers: as(DEVELOPER) })).status).toBe(400);
    expect((await app.request('/v1/projects/not-a-uuid/resources', { headers: as(DEVELOPER) })).status).toBe(400);
  });

  test('管理员视图与可做操作', async () => {
    expect((await app.request('/v1/admin/resources', { headers: as(DEVELOPER) })).status).toBe(403);
    expect((await app.request('/v1/admin/resources', { headers: as(ADMIN) })).status).toBe(200);
    const id = (await h.module.api.owner('task-runtime').find('http1', 'dev-workspace'))!.id;
    const post = (actor: Actor, body: unknown) => app.request(`/v1/resources/${id}/actions/release`, { method: 'POST', headers: { ...as(actor), 'content-type': 'application/json' }, body: JSON.stringify(body) });
    expect((await post(TESTER, {})).status).toBe(403);
    expect((await post(DEVELOPER, { unknown: true })).status).toBe(400);
    const accepted = await post(DEVELOPER, {});
    expect(accepted.status).toBe(202);
    expect(await accepted.json()).toMatchObject({ accepted: true, record: { phase: 'stopped' } });
    expect((await post(DEVELOPER, {})).status).toBe(412);
  });
});
