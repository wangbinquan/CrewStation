import { afterEach, describe, expect, test } from 'bun:test';
import { BUILTIN_RESOURCES, PROJECT_DELETION_PARTICIPANTS, PROJECT_DELETION_PHASES } from '@crewstation/contracts';
import { jsonHash, newResourceId } from '@crewstation/kernel';
import { testDatabaseAvailable } from '@crewstation/testkit';
import { sql } from 'drizzle-orm';
import { apiCatalogDeletionFixture, type ApiCatalogDeletionFixture } from './apiCatalogDeletionFixture';
import { apiAllocationRevision } from '../api/allocationRevision';

const available = await testDatabaseAvailable(); let f: ApiCatalogDeletionFixture;
afterEach(async () => { await f?.db.drop(); });
describe.skipIf(!available)('API 登记、授权与申请的项目清理（真实 PG）', () => {
  test('旧库升级保留原内容；盘点包括间接归属和其他项目受影响关系，不泄露原文', async () => {
    f = await apiCatalogDeletionFixture();
    const report = await f.catalog.api.deletionOwner!.inspect(await f.project.api.deletionScope(f.own.id));
    expect(report.complete).toBe(true); expect(report.resources.map((r) => r.kind)).toEqual(['proxies', 'operations', 'grants', 'requests', 'allocation_receipts']);
    expect(report.resources.every((r) => r.count === 1)).toBe(true); expect(report.references).toHaveLength(1);
    expect(JSON.stringify(report)).not.toContain('erase-owned'); expect(JSON.stringify(report)).not.toContain('retain-incoming-reason');
    expect([...(await f.db.db.execute(sql`SELECT document FROM api_catalog.proxies WHERE id=${f.ids.proxy}`))]).toEqual([{ document: { private: 'erase-owned' } }]);
    const alias = 'catalog-delete:GET:/items';
    await f.db.db.execute(sql`INSERT INTO api_catalog.resource_identity_aliases(kind,key,id) VALUES ('api-operation',${JSON.stringify([alias])},${f.ids.operation})`);
    expect(await f.catalog.api.originalOperationProject(f.ids.operation)).toBe(f.own.id);
    expect(await f.catalog.api.originalOperationProject(alias)).toBe(f.own.id);
    expect(await f.catalog.api.originalOperationProject('unknown-original-operation')).toBeUndefined();
    await f.db.db.execute(sql`INSERT INTO api_catalog.resource_identity_aliases(kind,key,id) VALUES ('api-operation',${JSON.stringify([f.ids.operation])},${f.ids.otherOperation})`);
    await expect(f.catalog.api.originalOperationProject(f.ids.operation)).rejects.toMatchObject({ kind: 'precondition' });
  });
  test('seal 立即移出可调用目录；迟到登记、审批、间接写和跨项目搬移均由数据库阻断', async () => {
    f = await apiCatalogDeletionFixture(); const started = await f.begin();
    expect((await f.catalog.api.deletionOwner!.run(started.context)).kind).toBe('done');
    expect(await f.catalog.api.activeProxyNameOf(f.own.serviceId!)).toBeUndefined();
    expect((await f.catalog.api.grantedOperations('catalog-keep/catalog-keep')).defaultOpen).not.toContain(f.ids.operation);
    for (const query of [sql`UPDATE api_catalog.proxies SET project_id=${f.other.id} WHERE id=${f.ids.proxy}`,
      sql`UPDATE api_catalog.operations SET state='active' WHERE id=${f.ids.operation}`,
      sql`UPDATE api_catalog.grants SET state='granted' WHERE service_id=${f.other.serviceId} AND operation_id=${f.ids.operation}`,
      sql`UPDATE api_catalog.requests SET state='approved' WHERE id=${f.ids.incoming}`,
      sql`DELETE FROM api_catalog.allocation_receipts WHERE service_id=${f.own.serviceId}`]) {
      await expect(Promise.resolve(f.db.db.execute(query))).rejects.toMatchObject({ cause: { message: 'project API catalog is sealed for deletion' } });
    }
    await expect(f.catalog.api.deletionOwner!.run({ ...started.context, phase: 'metadata' })).rejects.toMatchObject({ kind: 'precondition' });
    expect([...(await f.db.db.execute(sql`SELECT reason FROM api_catalog.requests WHERE id=${f.ids.incoming}`))]).toEqual([{ reason: 'retain-incoming-reason' }]);
  });
  test('全部前序证明后清掉本项目所有历史，其他项目申请保留且失效；最小原 ID 防止根消失后复活', async () => {
    f = await apiCatalogDeletionFixture();
    const extra = Array.from({ length: 1501 }, () => ({ id: newResourceId(), service_id: f.own.serviceId!, project_id: f.own.id, operation_id: f.ids.otherOperation, state: 'rejected', reason: 'erase-history', requested_by: f.admin.userId, created_at: new Date().toISOString() }));
    await f.db.db.execute(sql`INSERT INTO api_catalog.requests(id,service_id,project_id,operation_id,state,reason,requested_by,created_at) SELECT id,service_id,project_id,operation_id,state,reason,requested_by,created_at FROM jsonb_to_recordset(${JSON.stringify(extra)}::jsonb) AS r(id text,service_id text,project_id text,operation_id text,state text,reason text,requested_by text,created_at timestamptz)`);
    const started = await f.begin(); expect(started.context.confirmed.resources.find((r) => r.kind === 'requests')?.count).toBe(1502);
    for (const phase of PROJECT_DELETION_PHASES) for (const participant of [...PROJECT_DELETION_PARTICIPANTS.filter((p) => p !== 'project'), 'project' as const]) {
      const owner = participant === 'api-catalog' ? f.catalog.api.deletionOwner : participant === 'project' ? f.project.api.deletionOwner : undefined;
      const context = { ...started.context, phase, confirmed: started.plan.participants.find((r) => r.participant === participant)! };
      const step = owner ? await owner.run(context) : { kind: 'done' as const, evidence: { kind: 'not-applicable' as const, digest: jsonHash({ participant, phase }), description: '其他 owner 的空范围仅用于模块许可测试', count: 0 } };
      expect(step.kind).toBe('done'); if (step.kind !== 'done') throw new Error('Module cleanup blocked');
      if (participant === 'api-catalog' && phase === 'metadata') expect(await owner!.run(context)).toEqual(step);
      await f.project.api.recordProjectDeletionReceipt(started.lease, participant, phase, step.evidence);
    }
    expect((await f.project.api.completeProjectDeletion(started.lease)).state).toBe('succeeded');
    expect(await f.catalog.api.originalOperationProject(f.ids.operation)).toBe(f.own.id);
    expect(await f.catalog.api.originalOperationProject(f.ids.otherOperation)).toBe(f.other.id);
    expect((await f.catalog.api.deletionOwner!.inspect(started.context.target)).resources.every((r) => r.count === 0)).toBe(true);
    expect([...(await f.db.db.execute(sql`SELECT reason,state FROM api_catalog.requests WHERE id=${f.ids.incoming}`))]).toEqual([{ reason: 'retain-incoming-reason', state: 'rejected' }]);
    expect([...(await f.db.db.execute(sql`SELECT state FROM api_catalog.grants WHERE service_id=${f.other.serviceId} AND operation_id=${f.ids.operation}`))]).toEqual([{ state: 'revoked' }]);
    expect([...(await f.db.db.execute(sql`SELECT document FROM api_catalog.proxies WHERE id=${f.ids.otherProxy}`))]).toEqual([{ document: { private: 'retain-other' } }]);
    await expect(Promise.resolve(f.db.db.execute(sql`INSERT INTO api_catalog.operations(id,proxy_id,proxy,method,path,open_policy,state,updated_at) VALUES (${f.ids.operation},${f.ids.otherProxy},'catalog-keep','GET','/late','default','active',now())`))).rejects.toMatchObject({ cause: { message: 'project API catalog is sealed for deletion' } });
  });
  test('确认后变化、未知内容表与不相符 owner 都不能给出成功证明', async () => {
    f = await apiCatalogDeletionFixture(); const started = await f.begin();
    await f.db.db.execute(sql`UPDATE api_catalog.operations SET summary='late-content' WHERE id=${f.ids.operation}`);
    expect(await f.catalog.api.deletionOwner!.run(started.context)).toMatchObject({ kind: 'blocked', blockers: [{ code: 'inventory-changed' }] });
    expect(await f.catalog.api.deletionOwner!.run(started.context)).toMatchObject({ kind: 'blocked', blockers: [{ code: 'inventory-changed' }] });
    await expect(f.catalog.api.deletionOwner!.run({ ...started.context, confirmed: started.plan.participants.find((p) => p.participant === 'scm')! })).rejects.toMatchObject({ kind: 'precondition' });
    await f.db.db.execute('CREATE TABLE api_catalog.unknown_content(project_id text)');
    try { await expect(f.catalog.api.deletionOwner!.inspect(started.context.target)).rejects.toMatchObject({ kind: 'precondition' }); }
    finally { await f.db.db.execute('DROP TABLE api_catalog.unknown_content'); }
  });
  test('尚未发布 API 的调用方直接分配也固定归属，不能留下无项目的授权或回执', async () => {
    f = await apiCatalogDeletionFixture();
    const caller = await f.project.api.createProject(f.admin, { slug: 'catalog-no-proxy', name: 'Caller', kind: 'DigitalWorker', template: BUILTIN_RESOURCES.minimalTemplate });
    await f.catalog.api.setOpenPolicy(f.admin, f.ids.otherOperation, 'targeted');
    const op = (await f.catalog.api.listOperations(f.admin)).find((r) => r.id === f.ids.otherOperation)!;
    await f.catalog.api.applyResourceChange(f.admin, caller.serviceId!, { operationId: newResourceId(), target: { resourceType: 'api-operation', resourceId: op.id, action: 'grant' }, expectedRevision: apiAllocationRevision(op, false), values: {} });
    // 直接分配不经过申请和代理登记，以前无法为 SQL 屏障识别调用方项目。
    expect([...(await f.db.db.execute(sql`SELECT project_id FROM api_catalog.deletion_entities WHERE kind='service' AND entity_id=${caller.serviceId}`))]).toEqual([{ project_id: caller.id }]);
    const report = await f.catalog.api.deletionOwner!.inspect(await f.project.api.deletionScope(caller.id));
    expect(report.resources.find((r) => r.kind === 'grants')?.count).toBe(1);
    expect(report.resources.find((r) => r.kind === 'allocation_receipts')?.count).toBe(1);
    await expect(Promise.resolve(f.db.db.execute(sql`INSERT INTO api_catalog.allocation_receipts VALUES (${newResourceId()},${newResourceId()},'{}')`))).rejects.toMatchObject({ cause: { message: 'API catalog service ownership is unresolved' } });
  });
  test('持久失败只能由管理员新计划重新确认恢复，旧材料和普通继续不能将其变成已封闭', async () => {
    f = await apiCatalogDeletionFixture(); const started = await f.begin();
    await f.db.db.execute(sql`UPDATE api_catalog.operations SET summary='new-confirmed-material' WHERE id=${f.ids.operation}`);
    expect((await f.catalog.api.deletionOwner!.run(started.context)).kind).toBe('blocked');
    await f.project.api.blockProjectDeletion(started.lease, [{ participant: 'api-catalog', code: 'inventory-changed', message: '确认后新提交' }]);
    const target = await f.project.api.deletionScope(f.own.id), report = await f.catalog.api.deletionOwner!.inspect(target);
    const reports = started.plan.participants.map((r) => r.participant === 'api-catalog' ? report : r);
    const plan = await f.project.api.prepareProjectDeletionReconfirmation(f.admin, started.operation.id, reports);
    await f.project.api.reconfirmProjectDeletion(f.admin, started.operation.id, { planId: plan.id, requestKey: newResourceId(), confirm: 'delete' }, reports);
    const claimed = (await f.project.api.claimProjectDeletion(started.operation.id, 'catalog-reconfirmation'))!;
    await expect(f.catalog.api.deletionOwner!.run({ ...started.context, generation: claimed.lease.generation })).rejects.toMatchObject({ kind: 'precondition' });
    const context = { ...started.context, generation: claimed.lease.generation, target: plan.target, confirmed: plan.participants.find((p) => p.participant === 'api-catalog')! };
    expect((await f.catalog.api.deletionOwner!.run(context)).kind).toBe('done');
    expect((await f.catalog.api.deletionOwner!.run(context)).kind).toBe('done');
    expect([...(await f.db.db.execute(sql`SELECT scope_verified FROM api_catalog.deletion_fences WHERE project_id=${f.own.id}`))]).toEqual([{ scope_verified: true }]);
  });
  test('seal 等原在途事务退出；确认前未见的提交会持久阻塞，不能重试成成功', async () => {
    f = await apiCatalogDeletionFixture(); const started = await f.begin();
    let release!: () => void, entered!: () => void;
    const held = new Promise<void>((resolve) => { release = resolve; }), ready = new Promise<void>((resolve) => { entered = resolve; });
    const writer = f.db.db.transaction(async (tx) => { await tx.execute(sql`UPDATE api_catalog.operations SET summary='in-flight-change' WHERE id=${f.ids.operation}`); entered(); await held; });
    await ready; let done = false;
    const seal = f.catalog.api.deletionOwner!.run(started.context).finally(() => { done = true; });
    try {
      const deadline = Date.now() + 5000; let waiting = false;
      while (!waiting && Date.now() < deadline) {
        const [row] = await f.db.db.execute<{ waiting: boolean }>(sql`SELECT EXISTS(SELECT 1 FROM pg_stat_activity WHERE datname=current_database() AND wait_event_type='Lock' AND query LIKE '%api_catalog.deletion_fences%') AS waiting`);
        waiting = row?.waiting ?? false;
      }
      expect(waiting).toBe(true); expect(done).toBe(false);
    } finally { release(); await writer; }
    expect(await seal).toMatchObject({ kind: 'blocked', blockers: [{ code: 'inventory-changed' }] });
    expect(await f.catalog.api.deletionOwner!.run(started.context)).toMatchObject({ kind: 'blocked', blockers: [{ code: 'inventory-changed' }] });
    await expect(Promise.resolve(f.db.db.execute(sql`UPDATE api_catalog.operations SET summary='late' WHERE id=${f.ids.operation}`))).rejects.toMatchObject({ cause: { message: 'project API catalog is sealed for deletion' } });
  });
});
