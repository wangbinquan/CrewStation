import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { sql } from 'drizzle-orm';
import { isPlatformError } from '@crewstation/kernel';
import { testDatabaseAvailable } from '@crewstation/testkit';
import type { Harness } from './fixtures';
import { createHarness, execution, OTHER_PROJECT, pod, PROJECT, workspace } from './fixtures';

const available = await testDatabaseAvailable();

async function rejected(promise: Promise<unknown>): Promise<{ kind: string; message: string; details: Record<string, unknown> }> {
  try {
    await promise;
  } catch (error) {
    if (isPlatformError(error)) return { kind: error.kind, message: error.message, details: error.details };
    throw error;
  }
  throw new Error('expected rejection');
}

describe.skipIf(!available)('资源台账：声明、观测、释放（RFC-025 设计 §2、§3）', () => {
  let h: Harness;
  beforeAll(async () => { h = await createHarness(); });
  afterAll(async () => { await h.database.drop(); });

  const changes = async (resourceId: string) => (await h.database.db.execute(sql`SELECT seq, version, change FROM resources.changes WHERE resource_id = ${resourceId} ORDER BY seq`)) as unknown as { seq: string; version: string; change: string }[];

  test('声明：新建是分配中、版本 1、写一行变更；同样的期望再声明不写库；期望变了代数加一', async () => {
    const ledger = h.module.api.owner('task-runtime');
    const created = await ledger.declare(workspace('a1'));
    expect(created).toMatchObject({ kind: 'dev-workspace', phase: 'provisioning', generation: 1, version: 1, desired: 'present', display: { branch: 'main' } });
    expect(created.children).toEqual([{ kind: 'Pod', namespace: 'cs-demo', name: 'task-a1', phase: 'absent', ready: false }]);
    expect(await changes(created.id)).toHaveLength(1);
    const again = await ledger.declare(workspace('a1'));
    expect(again.version).toBe(1);
    expect(await changes(created.id)).toHaveLength(1);
    const replaced = await ledger.declare(workspace('a1', { spec: { children: [{ kind: 'Pod', namespace: 'cs-demo', name: 'task-r-a1' }] } }));
    expect(replaced).toMatchObject({ id: created.id, generation: 2, version: 2 });
    expect(replaced.children.map((c) => c.name)).toEqual(['task-r-a1']);
  });

  test('观测：Pod 就绪还要 Runner 连上才是运行中；Pod 消失回到分配中；重复观测不写库', async () => {
    const ledger = h.module.api.owner('task-runtime');
    const record = await ledger.declare(workspace('b1'));
    const seen = await h.module.api.observe({ child: pod('task-b1', { uid: 'uid-b1', node: 'node-1' }) });
    expect(seen.status).toBe('recorded');
    if (seen.status !== 'recorded') return;
    expect(seen.record).toMatchObject({ phase: 'starting', reason: { code: 'waiting-connect' } });
    expect((await h.module.api.observe({ child: pod('task-b1', { uid: 'uid-b1', node: 'node-1' }) })).status).toBe('unchanged');
    const ready = await ledger.report(record.id, { conditions: [{ type: 'RunnerConnected', status: 'true' }] });
    expect(ready.phase).toBe('ready');
    // 从库里读回的条件键序与新建的不同：同样的上报仍然不写库
    expect((await ledger.report(record.id, { conditions: [{ type: 'RunnerConnected', status: 'true' }] })).version).toBe(ready.version);
    // 旧实例迟到的删除事件（UID 不同）不算数
    expect((await h.module.api.observe({ child: pod('task-b1', { uid: 'uid-old' }), gone: true })).status).toBe('unchanged');
    const gone = await h.module.api.observe({ child: pod('task-b1', { uid: 'uid-b1' }), gone: true });
    expect(gone.status === 'recorded' && gone.record.phase).toBe('provisioning');
    expect((await h.module.api.observe({ child: pod('not-mine') })).status).toBe('unowned');
    expect(await h.module.api.claimOf({ kind: 'Pod', namespace: 'cs-demo', name: 'task-b1' })).toBe(record.id);
    expect(await h.module.api.claimOf({ kind: 'Pod', namespace: 'cs-demo', name: 'elsewhere', uid: 'uid-b1' })).toBeUndefined();
    expect(await h.module.api.claimOf({ kind: 'Pod', namespace: 'cs-demo', name: 'not-mine' })).toBeUndefined();
  });

  test('释放：受理即结束中，子对象都回收了是已结束且名字释放；再释放原样返回；已释放的不能重新声明', async () => {
    const ledger = h.module.api.owner('task-runtime');
    const record = await ledger.declare(workspace('c1'));
    await h.module.api.observe({ child: pod('task-c1', { uid: 'uid-c1' }) });
    const stopping = await ledger.requestRelease(record.id, { code: 'user', message: '用户释放' });
    expect(stopping).toMatchObject({ desired: 'absent', phase: 'stopping', reason: { code: 'user' }, generation: 2 });
    expect((await ledger.requestRelease(record.id, { code: 'user', message: '再点一次' })).version).toBe(stopping.version);
    const stopped = await h.module.api.observe({ child: pod('task-c1', { uid: 'uid-c1' }), gone: true });
    expect(stopped.status === 'recorded' && stopped.record).toMatchObject({ phase: 'stopped', children: [] });
    expect((await rejected(ledger.declare(workspace('c1')))).kind).toBe('conflict');
    // 名字已释放：新记录可以认领同名对象
    const reuse = await ledger.declare(workspace('c2', { spec: { children: [{ kind: 'Pod', namespace: 'cs-demo', name: 'task-c1' }] } }));
    expect(reuse.children[0]?.name).toBe('task-c1');
  });

  test('拒绝：别的模块改不了期望；领域模块不能写资源中心的条件；一个集群对象只属于一条记录；未知种类', async () => {
    const record = await h.module.api.owner('task-runtime').declare(workspace('d1'));
    expect((await rejected(h.module.api.owner('dev-session').requestRelease(record.id, { code: 'x', message: 'x' }))).kind).toBe('forbidden');
    expect((await rejected(h.module.api.owner('dev-session').declare({ ...workspace('d1'), id: record.id }))).kind).toBe('conflict');
    expect((await rejected(h.module.api.owner('task-runtime').report(record.id, { conditions: [{ type: 'Observed', status: 'true' }] }))).message).toContain('只能由资源中心写');
    expect((await rejected(h.module.api.owner('task-runtime').declare(workspace('d2', { spec: { children: [{ kind: 'Pod', namespace: 'cs-demo', name: 'task-d1' }] } })))).kind).toBe('conflict');
    expect((await rejected(h.module.api.owner('task-runtime').declare({ ...workspace('d3'), kind: 'nope' as never }))).kind).toBe('validation');
    expect((await rejected(h.module.api.owner('task-runtime').report('01a0bf5d-8f4b-7c01-8e19-e226732a7599', {}))).kind).toBe('not_found');
  });

  test('上报：启动进度、展示字段、空闲起点可设可清；失败的开发会话写 72 小时保留', async () => {
    const ledger = h.module.api.owner('task-runtime');
    const record = await ledger.declare(workspace('e1'));
    const startup = { state: 'running' as const, stages: [{ kind: 'queue' as const, state: 'running' as const }], startedAt: h.clock.now().toISOString() };
    const reported = await ledger.report(record.id, { startup, display: { branch: 'dev' }, idleSince: h.clock.now() });
    expect(reported).toMatchObject({ startup, display: { branch: 'dev' }, idleSince: h.clock.now() });
    const cleared = await ledger.report(record.id, { startup: null, idleSince: null });
    expect(cleared.startup).toBeUndefined();
    expect(cleared.idleSince).toBeUndefined();
    const failed = await ledger.report(record.id, { conditions: [{ type: 'Failed', status: 'true', reason: 'connect-timeout', message: '超过 5 分钟未连接' }] });
    expect(failed).toMatchObject({ phase: 'failed', reason: { code: 'connect-timeout' } });
    expect(failed.retainUntil?.getTime()).toBe(h.clock.now().getTime() + 72 * 3_600_000);
  });

  test('在所属模块的事务里写：事务回滚，台账与变更日志都不留痕', async () => {
    const before = (await h.module.api.list({ projectId: PROJECT, includeStopped: true })).length;
    await expect(h.database.db.transaction(async (tx) => {
      await h.module.api.owner('task-runtime').within(tx).declare(workspace('f1'));
      throw new Error('所属模块自己的写入失败');
    })).rejects.toThrow('所属模块自己的写入失败');
    expect((await h.module.api.list({ projectId: PROJECT, includeStopped: true })).length).toBe(before);
    const committed = await h.database.db.transaction((tx) => h.module.api.owner('task-runtime').within(tx).declare(workspace('f2')));
    expect((await h.module.api.get(committed.id))?.version).toBe(1);
  });

  test('别名：旧名字能找回记录；同一个别名不能给两条记录', async () => {
    const ledger = h.module.api.owner('task-runtime');
    const record = await ledger.declare(workspace('g1', { aliases: [{ source: 'tsk', alias: 'tsk_legacy1' }] }));
    expect(record.aliases).toEqual([{ source: 'tsk', alias: 'tsk_legacy1' }]);
    expect(await h.module.api.resolveAlias({ source: 'tsk', alias: 'tsk_legacy1' })).toBe(record.id);
    const updated = await ledger.declare(workspace('g1', { aliases: [{ source: 'pvc-name', alias: 'work-legacy1' }] }));
    expect((await h.module.api.get(updated.id))?.aliases).toEqual([{ source: 'pvc-name', alias: 'work-legacy1' }, { source: 'tsk', alias: 'tsk_legacy1' }]);
    expect((await rejected(ledger.declare(workspace('g2', { aliases: [{ source: 'tsk', alias: 'tsk_legacy1' }] })))).kind).toBe('conflict');
  });

  test('父子：Agent 执行挂在工作区下，按上级列出；别的项目的记录不混进来', async () => {
    const ledger = h.module.api.owner('task-runtime');
    const parent = await ledger.declare(workspace('h1'));
    await ledger.declare(execution('h1-cli', parent.id));
    await ledger.declare({ ...workspace('h2'), projectId: OTHER_PROJECT, spec: { children: [] } });
    expect((await h.module.api.list({ parentId: parent.id })).map((r) => r.owner.ref)).toEqual(['h1-cli']);
    expect((await h.module.api.list({ projectId: OTHER_PROJECT })).map((r) => r.owner.ref)).toEqual(['h2']);
  });
});

describe.skipIf(!available)('受理与额度（设计 §3、D31）', () => {
  let h: Harness;
  beforeAll(async () => { h = await createHarness(); });
  afterAll(async () => { await h.database.drop(); });

  test('额度按台账推导：到上限拒绝；结束中仍占；回收完额度自然回来；不占额度的种类不受限', async () => {
    const ledger = h.module.api.owner('task-runtime');
    h.quota.limit = 2;
    const first = await ledger.admit(workspace('q1'));
    await ledger.admit(execution('q1-cli', first.id));
    const denied = await rejected(ledger.admit(execution('q1-cli2', first.id)));
    expect(denied).toMatchObject({ kind: 'quota_exceeded', details: { limit: 2, used: 2 } });
    await h.module.api.observe({ child: pod('exec-q1-cli', { uid: 'uid-q1-cli' }) });
    await ledger.requestRelease((await ledger.find('q1-cli', 'agent-execution'))!.id, { code: 'user', message: '结束 CLI' });
    expect((await rejected(ledger.admit(execution('q1-cli2', first.id)))).kind).toBe('quota_exceeded');
    await h.module.api.observe({ child: pod('exec-q1-cli', { uid: 'uid-q1-cli' }), gone: true });
    expect((await ledger.admit(execution('q1-cli2', first.id))).phase).toBe('provisioning');
    expect((await ledger.admit({ kind: 'volume', ref: 'q1-work', projectId: PROJECT, spec: { children: [] } })).kind).toBe('volume');
    expect((await ledger.admit(execution('q1-cli2', first.id))).version).toBeGreaterThan(0);
  });

  test('两个事务同时抢最后一个额度：项目行锁串行，恰好一个成功', async () => {
    const ledger = h.module.api.owner('business-task');
    h.quota.limit = 4;
    const used = (await h.module.api.list({ projectId: PROJECT })).filter((r) => r.kind !== 'volume').length;
    h.quota.limit = used + 1;
    const results = await Promise.allSettled([ledger.admit(workspace('race-1', { kind: 'business-workspace' })), ledger.admit(workspace('race-2', { kind: 'business-workspace' }))]);
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    const failure = results.find((r) => r.status === 'rejected') as PromiseRejectedResult;
    expect(isPlatformError(failure.reason) && failure.reason.kind).toBe('quota_exceeded');
  });

  test('项目没有配置额度：拒绝并写明原因', async () => {
    h.quota.limit = undefined;
    expect((await rejected(h.module.api.owner('task-runtime').admit(workspace('q9')))).message).toBe('项目尚未配置并发任务配额');
    h.quota.limit = 2;
  });
});

describe.skipIf(!available)('变更日志、租约、维护（设计 §6.3、§6.4、§8.3）', () => {
  let h: Harness;
  beforeAll(async () => { h = await createHarness(); });
  afterAll(async () => { await h.database.drop(); });

  test('变更日志的序号按提交顺序：先写后提交的事务拿到更大的序号', async () => {
    const ledger = h.module.api.owner('task-runtime');
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const slow = h.database.db.transaction(async (tx) => { const r = await ledger.within(tx).declare(workspace('s-slow')); await gate; return r; });
    await Bun.sleep(50);
    const fast = await ledger.declare(workspace('s-fast'));
    release();
    const slowRecord = await slow;
    const rows = (await h.database.db.execute(sql`SELECT resource_id FROM resources.changes WHERE resource_id IN (${fast.id}, ${slowRecord.id}) ORDER BY seq`)) as unknown as { resource_id: string }[];
    expect(rows.map((row) => row.resource_id)).toEqual([fast.id, slowRecord.id]);
  });

  test('租约：持有期内别人抢不到，持有者可续约；过期后另一副本接手；释放只认持有者', async () => {
    const { leases } = h.module.api;
    const id = '01a0bf5d-8f4b-7c01-8e19-e226732a7600';
    expect(await leases.acquire(id, 'controller-a', 30_000)).toBe(true);
    expect(await leases.acquire(id, 'controller-b', 30_000)).toBe(false);
    expect(await leases.renew(id, 'controller-a', 30_000)).toBe(true);
    expect(await leases.renew(id, 'controller-b', 30_000)).toBe(false);
    await h.database.db.execute(sql`UPDATE resources.leases SET expires_at = now() - interval '1 second' WHERE resource_id = ${id}`);
    expect(await leases.acquire(id, 'controller-b', 30_000)).toBe(true);
    await leases.release(id, 'controller-a');
    expect(await leases.acquire(id, 'controller-a', 30_000)).toBe(false);
    await leases.release(id, 'controller-b');
    expect(await leases.acquire(id, 'controller-a', 30_000)).toBe(true);
  });

  test('保留期到了：失败的开发会话转成「不要了」（retention-expired）；没到的不动', async () => {
    const ledger = h.module.api.owner('task-runtime');
    const due = await ledger.declare(workspace('r1'));
    const kept = await ledger.declare(workspace('r2'));
    for (const id of [due.id, kept.id]) await ledger.report(id, { conditions: [{ type: 'Failed', status: 'true', reason: 'connect-timeout', message: '超时' }] });
    await h.database.db.execute(sql`UPDATE resources.records SET retain_until = now() - interval '1 minute' WHERE id = ${due.id}`);
    await h.module.maintainOnce();
    expect(await h.module.api.get(due.id)).toMatchObject({ desired: 'absent', phase: 'stopped', releaseReason: { code: 'retention-expired' } });
    expect(await h.module.api.get(kept.id)).toMatchObject({ desired: 'present', phase: 'failed' });
  });

  test('压缩：已结束满 7 天的记录只留身份与最终阶段，并写一条移除；变更日志清理保留最新一条', async () => {
    const ledger = h.module.api.owner('task-runtime');
    const old = await ledger.declare(workspace('p1'));
    await ledger.requestRelease(old.id, { code: 'user', message: '释放' });
    await h.database.db.execute(sql`UPDATE resources.records SET phase_since = now() - interval '8 days' WHERE id = ${old.id}`);
    await h.module.maintainOnce();
    const compacted = await h.module.api.get(old.id);
    expect(compacted).toMatchObject({ phase: 'stopped', children: [], conditions: [], reason: { code: 'user' } });
    expect(compacted?.compactedAt).toBeInstanceOf(Date);
    const log = (await h.database.db.execute(sql`SELECT change FROM resources.changes WHERE resource_id = ${old.id} ORDER BY seq DESC LIMIT 1`)) as unknown as { change: string }[];
    expect(log[0]?.change).toBe('remove');
    await h.database.db.execute(sql`UPDATE resources.changes SET at = now() - interval '2 days'`);
    await h.module.maintainOnce();
    const left = (await h.database.db.execute(sql`SELECT count(*)::int AS n FROM resources.changes`)) as unknown as { n: number }[];
    expect(left[0]?.n).toBe(1);
  });
});
