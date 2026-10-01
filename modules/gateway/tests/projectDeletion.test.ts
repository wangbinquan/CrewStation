import { afterEach, describe, expect, test } from 'bun:test';
import type { AllowlistDocument, WorkloadIdentity } from '@crewstation/contracts';
import { ProjectIdSchema } from '@crewstation/contracts';
import { jsonHash, newResourceId } from '@crewstation/kernel';
import { testDatabaseAvailable } from '@crewstation/testkit';
import type { Database } from '@crewstation/persistence';
import { sql } from 'drizzle-orm';
import { gatewayContent, gatewayDeletionFixture, type GatewayDeletionFixture } from './gatewayDeletionFixture';
import { gatewayDeletionRepository, saveGatewayDocument } from '../adapters/persistence/projectDeletion';
import { drizzlePodIdentityRepository } from '../adapters/persistence/drizzleRepositories';

const available = await testDatabaseAvailable(); let f: GatewayDeletionFixture;
afterEach(async () => { await f?.db.drop(); });
const owner = () => f.gateway.api.deletionOwner!;
const scope = () => f.project.api.deletionScope(f.own.id);
const workload = (slug: string): WorkloadIdentity => ({ identity: `${slug}/${slug}`, project: slug, service: slug, kind: 'service', slot: 'prod' });

describe.skipIf(!available)('网关项目清理（真实 PG、正式项目许可）', () => {
  test('无损升级保留所有历史原文；盘点只给摘要，旧操作别名和间接授权均归原 UUID', async () => {
    f = await gatewayDeletionFixture();
    expect(await gatewayContent(f.db.db)).toEqual(f.before);
    const report = await owner().inspect(await scope());
    expect(report.complete).toBe(true); expect(report.blockers).toEqual([]);
    expect(report.references).toEqual([{ kind: 'allowlist-incoming-caller', id: f.other.id, projectId: f.other.id, description: '本项目接口关闭后，该项目在共享放行表中的相关授权关系会移除，其他授权保留' }]);
    expect(report.resources.filter((r) => r.kind !== 'allowlist-project-parts').map((r) => r.count)).toEqual([1, 1, 1, 1, 1, 1]);
    expect(report.resources.find((r) => r.kind === 'allowlist-project-parts')?.count).toBe(7);
    expect(JSON.stringify(report)).not.toContain('erase-owned'); expect(JSON.stringify(report)).not.toContain('retain-other-entry');
    expect((await f.project.api.resolveServiceOfSlug(f.own.slug))?.projectId).toBe(f.own.id);
    expect(await f.project.api.resolveServiceOfSlug('absent')).toBeUndefined();
    expect(await f.project.api.availableProjectIds([])).toEqual([]);
    expect([...await f.project.api.availableProjectIds([f.own.id, f.other.id, f.own.id, ProjectIdSchema.parse(newResourceId())])].sort()).toEqual([f.own.id, f.other.id].sort());
  });

  test('预热的放行与维护缓存不能越过原项目关闭；无清理许可的删改、跨项目搬移和历史改写均失败', async () => {
    f = await gatewayDeletionFixture(); let observations = 0;
    const hot = f.application({ applier: { applyRoutes: async () => {}, applyMiddlewares: async () => {}, removeRoutes: async () => {}, observeRoutes: async () => { observations += 1; return true; } } });
    await hot.api.reconcileService(f.own.serviceId!);
    expect(await hot.api.productionRouteObserved(f.own.serviceId!, 'blue')).toBe(true);
    expect((await hot.api.evaluate(workload(f.own.slug), { host: 'api.svc.test', method: 'GET', path: '/api/gateway-keep/keep' })).allowed).toBe(true);
    expect((await hot.api.userEntry(f.admin.userId, f.own.slug, 'prod')).kind).toBe('maintenance');
    expect((await hot.api.lookupByIp('10.1.1.1'))?.identity).toBe('gateway-delete/gateway-delete');
    const started = await f.begin(); expect((await f.project.api.resolveServiceOfSlug(f.own.slug))?.state).toBe('deleting');
    expect(await f.project.api.availableProjectIds([f.own.id, f.other.id])).toEqual([f.other.id]);
    expect((await owner().run(started.context)).kind).toBe('done');
    expect(await hot.api.productionRouteObserved(f.own.serviceId!, 'blue')).toBe(false); expect(observations).toBe(1);
    expect((await hot.api.evaluate(workload(f.own.slug), { host: 'api.svc.test', method: 'GET', path: '/api/gateway-keep/keep' })).allowed).toBe(false);
    expect((await hot.api.evaluate(workload(f.other.slug), { host: 'api.svc.test', method: 'GET', path: '/api/gateway-delete/erase' })).allowed).toBe(false);
    expect((await hot.api.evaluate(workload(f.other.slug), { host: 'api.svc.test', method: 'GET', path: '/api/gateway-keep/keep' })).allowed).toBe(true);
    await expect(hot.api.userEntry(f.admin.userId, f.own.slug, 'preview')).rejects.toMatchObject({ kind: 'not_found' });
    expect(await hot.api.lookupByIp('10.1.1.1')).toBeUndefined();
    for (const query of [sql`DELETE FROM gateway.routes WHERE service_id=${f.own.serviceId}`,
      sql`UPDATE gateway.service_maintenance SET project_id=${f.other.id} WHERE service_id=${f.own.serviceId}`,
      sql`UPDATE gateway.maintenance_events SET body='{"reason":"late"}' WHERE service_id=${f.own.serviceId}`,
      sql`DELETE FROM gateway.rate_limits WHERE scope=${f.own.id}`,
      sql`DELETE FROM gateway.rate_limit_receipts WHERE project_id=${f.own.id}`,
      sql`DELETE FROM gateway.pod_identities WHERE pod_uid='own-original'`,
      sql`DELETE FROM gateway.allowlists`, sql`UPDATE gateway.allowlists SET document='{}'`,
      sql`UPDATE gateway.deletion_entities SET project_id=${f.other.id} WHERE project_id=${f.own.id}`,
      sql`DELETE FROM gateway.deletion_document_owners WHERE project_id=${f.own.id}`])
      await expect(Promise.resolve(f.db.db.execute(query))).rejects.toThrow();
    await expect(hot.api.reconcileService(f.own.serviceId!)).rejects.toMatchObject({ kind: 'precondition' });
    await expect(owner().run({ ...started.context, phase: 'metadata' })).rejects.toMatchObject({ kind: 'precondition' });
    // 原 UID 停止观测可以保留，不允许以它创建替换实例。
    await f.db.db.execute(sql`UPDATE gateway.pod_identities SET deleted_at=now(),updated_at=now(),version=version+1 WHERE pod_uid='own-original'`);
    expect((await owner().inspect(started.context.target)).revision).toBe(started.context.confirmed.revision);
    await expect(Promise.resolve(f.db.db.execute(sql`UPDATE gateway.pod_identities SET ip='10.1.1.9' WHERE pod_uid='own-original'`))).rejects.toThrow();
    expect(await hot.api.purgeIdentityTombstones()).toBe(0);
  });

  test('跨 100 文档和 500 内容行完整清理，其他项目及共享文档字段顺序保持；同 slug 新 UUID 不继承旧版', async () => {
    f = await gatewayDeletionFixture({ versions: 102 });
    const history = Array.from({ length: 501 }, () => ({ id: newResourceId(), body: { reason: 'erase-owned-history', switches: { users: true, services: false, events: true }, allowUserIds: [] } }));
    await f.db.db.execute(sql`INSERT INTO gateway.maintenance_events(id,service_id,kind,actor_user_id,at,body) SELECT id,${f.own.serviceId},'adjusted',${f.admin.userId},now(),body FROM jsonb_to_recordset(${JSON.stringify(history)}::jsonb) AS c(id text,body jsonb)`);
    const hot = f.application(); await hot.api.currentAllowlist(); await hot.api.userEntry(f.admin.userId, f.own.slug, 'preview');
    const started = await f.begin();
    expect(started.context.confirmed.resources.find((r) => r.kind === 'maintenance_events')?.count).toBe(502);
    expect(started.context.confirmed.resources.find((r) => r.kind === 'allowlist-project-parts')?.count).toBe(407);
    await f.proceed(started); expect((await f.project.api.completeProjectDeletion(started.lease)).state).toBe('succeeded');
    const report = await owner().inspect(started.context.target); expect(report.complete).toBe(true); expect(report.resources.every((r) => r.count === 0)).toBe(true);
    const documents = [...await f.db.db.execute<{ version: number; document: Record<string, unknown> }>(sql`SELECT version,document FROM gateway.allowlists ORDER BY version`)];
    expect(documents).toHaveLength(102);
    for (const row of documents) {
      const old = (f.before['allowlists'] as { body: { version: number; document: Record<string, unknown> } }[]).find((r) => r.body.version === row.version)!.body.document;
      const otherOperation = row.version === 1 ? 'gateway-keep:GET:/keep' : f.ids.otherOperation;
      const expected = { ...old, entries: [{ ...(old['entries'] as Record<string, unknown>[])[0], operations: [otherOperation] }], defaultOpen: [otherOperation],
        ...(old['operationRoutes'] ? { operationRoutes: [(old['operationRoutes'] as unknown[])[0]] } : {}) };
      expect(row.document).toEqual(expected);
    }
    expect([...await f.db.db.execute(sql`SELECT body FROM gateway.rate_limits ORDER BY scope`)]).toEqual([{ body: { private: 'retain-other' } }, { body: { private: 'retain-platform' } }]);
    expect([...await f.db.db.execute(sql`SELECT body FROM gateway.maintenance_events`)]).toEqual((f.before['maintenance_events'] as { body: { service_id: string; body: unknown } }[]).filter((r) => r.body.service_id === f.other.serviceId).map((r) => ({ body: r.body.body })));
    const replacement = await f.create(f.own.slug); expect(replacement.id).not.toBe(f.own.id);
    expect((await f.project.api.resolveServiceOfSlug(f.own.slug))?.projectId).toBe(replacement.id);
    expect((await hot.api.evaluate(workload(f.own.slug), { host: 'api.svc.test', method: 'GET', path: '/api/gateway-keep/keep' })).allowed).toBe(false);
    expect((await hot.api.userEntry(f.admin.userId, f.own.slug, 'preview')).kind).toBe('open');
    await hot.api.rebuildAllowlist();
    expect((await hot.api.evaluate(workload(f.own.slug), { host: 'api.svc.test', method: 'GET', path: '/api/gateway-keep/keep' })).allowed).toBe(true);
    expect((await hot.api.currentAllowlist())?.operationRoutes.map((r) => r.id)).toEqual([f.ids.otherOperation]);
    expect(await hot.api.lookupByIp('10.1.1.1')).toBeUndefined();
    const pods = drizzlePodIdentityRepository(f.db.db, f.admission);
    await expect(pods.upsert({ namespace: f.own.namespace, podName: 'erase-owned', podUid: 'own-original', ip: '10.1.1.1', project: f.own.slug, service: f.own.slug, workload: 'service', updatedAt: new Date() })).rejects.toThrow();
  }, 45_000);

  test('范围变化会持久封闭；普通重试或替换旧摘要不能恢复，管理员新计划和世代才可继续', async () => {
    f = await gatewayDeletionFixture(); const started = await f.begin();
    await f.db.db.execute(sql`UPDATE gateway.routes SET routes='[{"late":"content"}]' WHERE service_id=${f.own.serviceId}`);
    expect(await owner().run(started.context)).toMatchObject({ kind: 'blocked', blockers: [{ code: 'inventory-changed' }] });
    expect(await owner().run(started.context)).toMatchObject({ kind: 'blocked', blockers: [{ code: 'inventory-changed' }] });
    await expect(Promise.resolve(f.db.db.execute(sql`DELETE FROM gateway.routes WHERE service_id=${f.own.serviceId}`))).rejects.toThrow();
    await f.project.api.blockProjectDeletion(started.lease, [{ participant: 'gateway', code: 'inventory-changed', message: '重新确认原网关内容' }]);
    const report = await owner().inspect(started.context.target), reports = started.plan.participants.map((r) => r.participant === 'gateway' ? report : r);
    const plan = await f.project.api.prepareProjectDeletionReconfirmation(f.admin, started.operation.id, reports);
    await f.project.api.reconfirmProjectDeletion(f.admin, started.operation.id, { planId: plan.id, requestKey: newResourceId(), confirm: 'delete' }, reports);
    const claimed = (await f.project.api.claimProjectDeletion(started.operation.id, 'gateway-reconfirmation'))!;
    await expect(owner().run({ ...started.context, generation: claimed.lease.generation })).rejects.toThrow();
    expect((await owner().run({ ...started.context, generation: claimed.lease.generation, target: plan.target, confirmed: plan.participants.find((p) => p.participant === 'gateway')! })).kind).toBe('done');
    await expect(owner().run({ ...started.context, operationId: newResourceId() })).rejects.toThrow();
  });

  test('未知原身份、畸形历史文档及新增未知内容表都不能被解释为空', async () => {
    for (const mode of ['pod', 'document', 'version'] as const) {
      f = await gatewayDeletionFixture({ beforeUpgrade: async (db) => {
        if (mode === 'pod') await db.execute(sql`UPDATE gateway.pod_identities SET pod_uid='unclassified-original' WHERE pod_uid='own-original'`);
        else await db.execute(sql`UPDATE gateway.allowlists SET document=${JSON.stringify(mode === 'document' ? { version: 1, entries: [{ caller: 'unknown/unknown', operations: [] }], defaultOpen: [] } : { version: 999, entries: [], defaultOpen: [] })}::jsonb WHERE version=1`);
      } });
      expect(await gatewayContent(f.db.db)).toEqual(f.before);
      const report = await owner().inspect(await scope()); expect(report.complete).toBe(false); expect(report.blockers.length).toBeGreaterThan(0);
      await expect(f.begin()).rejects.toThrow(); await f.db.drop();
    }
    f = await gatewayDeletionFixture(); await f.db.db.execute('CREATE TABLE gateway.unknown_content(project_id text)');
    await expect(owner().inspect(await scope())).rejects.toMatchObject({ kind: 'precondition' });
  });

  test('新历史版本需要每一个授权键的原归属；归属不可重写，缺失正式进程来源时不开副作用', async () => {
    f = await gatewayDeletionFixture();
    const doc = (await f.gateway.api.currentAllowlist())!;
    const forged = { ...doc, version: 3, defaultOpen: ['unknown-operation'], operationRoutes: [], entries: [] };
    await expect(saveGatewayDocument(f.db.db, f.admission, forged)).rejects.toMatchObject({ kind: 'precondition' });
    await expect(Promise.resolve(f.db.db.execute(sql`INSERT INTO gateway.allowlists VALUES (3,${JSON.stringify(forged)}::jsonb,now())`))).rejects.toThrow();
    // 保存后固定版本内的 caller；不能通过给调用方换 UUID 重认旧文档。
    await saveGatewayDocument(f.db.db, f.admission, { ...doc, version: 3 } as AllowlistDocument);
    await expect(f.admission.documentOwners({ ...doc, version: 3 }, [{ kind: 'caller', key: 'gateway-delete/gateway-delete', projectId: f.other.id }])).rejects.toMatchObject({ kind: 'precondition' });
    const noProcess = f.application({ processes: undefined });
    await expect(noProcess.api.reconcileService(f.other.serviceId!)).rejects.toMatchObject({ kind: 'precondition' });
    expect([...await f.db.db.execute(sql`SELECT id FROM gateway.deletion_work`)]).toEqual([]);
    const started = await f.begin();
    await expect(owner().run({ ...started.context, confirmed: { ...started.context.confirmed, participant: 'scm', revision: jsonHash('false') } })).rejects.toMatchObject({ kind: 'precondition' });
  });
});
test.skipIf(!available)('每请求的原项目视图批量核对准入，避免随项目数量逐个查询；关闭后的旧调用方继续拒绝', async () => {
  f = await gatewayDeletionFixture(); let calls = 0; const seen: string[][] = [];
  const repository = gatewayDeletionRepository(f.db.db, { originals: f.originals, availableMany: async (ids) => { calls += 1; seen.push([...ids]); return f.project.api.availableProjectIds(ids); } });
  const doc = (await f.gateway.api.currentAllowlist())!;
  expect((await repository.view(doc)).entries).toEqual(doc.entries); expect(calls).toBe(1);
  expect(seen[0]!.sort()).toEqual([f.own.id, f.other.id].sort());
  const started = await f.begin(); expect((await f.gateway.api.deletionOwner!.run(started.context)).kind).toBe('done');
  const view = await repository.view(doc); expect(calls).toBe(2);
  expect(view.entries.map((e) => e.caller)).toEqual(['gateway-keep/gateway-keep']);
  expect(await repository.callerAvailable('gateway-delete/gateway-delete', doc.version)).toBe(false);
});

test.skipIf(!available)('已封闭后新增未知内容表仍阻断，屏障持久保留，不可伪造清理或验证完成', async () => {
  f = await gatewayDeletionFixture(); const started = await f.begin();
  await f.db.db.execute('CREATE TABLE gateway.unknown_content(project_id text)');
  expect(await f.gateway.api.deletionOwner!.run(started.context)).toMatchObject({ kind: 'blocked', blockers: [{ code: 'inventory-changed' }] });
  expect((await f.db.db.execute(sql`SELECT operation_id,scope_verified FROM gateway.deletion_fences WHERE project_id=${f.own.id}`))[0]).toEqual({ operation_id: started.operation.id, scope_verified: false });
  await expect(Promise.resolve(f.db.db.execute(sql`DELETE FROM gateway.routes WHERE service_id=${f.own.serviceId}`))).rejects.toThrow();
  expect(await f.admission.available(f.own.id)).toBe(false);
});

test.skipIf(!available)('分页期间其他项目删除前页记录，后页的本项目内容仍完整计入', async () => {
  f = await gatewayDeletionFixture();
  for (const [prefix, serviceId] of [['a-other', f.other.serviceId], ['z-owned', f.own.serviceId]] as const) {
    const records = Array.from({ length: 501 }, (_, i) => ({ id: `${prefix}-${String(i).padStart(4, '0')}`, body: { reason: prefix } }));
    await f.db.db.execute(sql`INSERT INTO gateway.maintenance_events(id,service_id,kind,actor_user_id,at,body) SELECT id,${serviceId},'entered',${f.admin.userId},now(),body FROM jsonb_to_recordset(${JSON.stringify(records)}::jsonb) AS c(id text,body jsonb)`);
  }
  let removed = false;
  const concurrent = new Proxy(f.db.db, { get: (target, property, receiver) => property !== 'execute' ? Reflect.get(target, property, receiver) : async (...args: Parameters<Database['execute']>) => {
    const rows = await target.execute(...args), body = rows[0]?.['body'] as Record<string, unknown> | undefined;
    if (!removed && rows.length === 500 && body?.['kind'] === 'entered') {
      removed = true; await f.db.db.execute(sql`DELETE FROM gateway.maintenance_events WHERE id LIKE 'a-other-%'`);
    }
    return rows;
  } });
  const report = await gatewayDeletionRepository(concurrent, { originals: f.originals }).inspect(await scope());
  expect(removed).toBe(true); expect(report.complete).toBe(true);
  // OFFSET 曾因其他项目删除前页记录而漏掉本项目后页内容；按原主键继续必须保留完整范围。
  expect(report.resources.find((r) => r.kind === 'maintenance_events')?.count).toBe(502);
});

test.skipIf(!available)('启动恢复登记最新版原归属，后续每请求纯读取不再按授权键遍历跨模块目录', async () => {
  f = await gatewayDeletionFixture(); await f.admission.recover(); let reads = 0;
  const repository = gatewayDeletionRepository(f.db.db, { availableMany: f.project.api.availableProjectIds, originals: {
    ...f.originals, service: async (key) => { reads += 1; return f.originals.service(key); }, operation: async (key) => { reads += 1; return f.originals.operation(key); },
  } });
  const doc = (await f.gateway.api.currentAllowlist())!, before = await gatewayContent(f.db.db);
  expect((await repository.view(doc)).entries).toEqual(doc.entries); expect((await repository.view(doc)).operationRoutes).toEqual(doc.operationRoutes);
  expect(await repository.callerAvailable('gateway-delete/gateway-delete', doc.version)).toBe(true);
  expect(reads).toBe(0); expect(await gatewayContent(f.db.db)).toEqual(before);
  expect((await f.db.db.execute(sql`SELECT DISTINCT version FROM gateway.deletion_document_owners ORDER BY version`)).map((r) => r['version'])).toEqual([2]);
});
