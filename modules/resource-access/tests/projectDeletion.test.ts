import { afterEach, describe, expect, test } from 'bun:test';
import { PROJECT_DELETION_PARTICIPANTS, PROJECT_DELETION_PHASES } from '@crewstation/contracts';
import { jsonHash, newResourceId } from '@crewstation/kernel';
import { testDatabaseAvailable } from '@crewstation/testkit';
import { sql } from 'drizzle-orm';
import { resourceAccessDeletionFixture, type ResourceAccessDeletionFixture } from './projectDeletionFixture';

const available = await testDatabaseAvailable(); let f: ResourceAccessDeletionFixture;
afterEach(async () => { await f?.db.drop(); });
describe.skipIf(!available)('资源申请 owner 项目清理（真实 PG）', () => {
  test('公开原归属只读最小 UUID，不推断未知旧键；当前申请和原身份冲突必须拒绝', async () => {
    f = await resourceAccessDeletionFixture({ withoutIdentityGuard: true });
    const source = await f.resourceAccess.api.originalInfrastructureOwnership(f.ids.own);
    expect(source).toMatchObject({ complete: true, id: f.ids.own, scope: 'project', projectIds: [f.own.id] });
    expect(await f.resourceAccess.api.originalInfrastructureOwnership(f.ids.own, 'legacy')).toEqual(source);
    expect((await f.resourceAccess.api.originalInfrastructureOwnership(f.ids.other))?.projectIds).toEqual([f.other.id]);
    expect(JSON.stringify(source)).not.toContain('erase-owned-reason');
    expect(await f.resourceAccess.api.originalInfrastructureOwnership(newResourceId())).toBeUndefined();
    expect(await f.resourceAccess.api.originalInfrastructureOwnership('unknown-old-change', 'legacy')).toBeUndefined();
    await expect(f.resourceAccess.api.originalInfrastructureOwnership('resource-delete')).rejects.toThrow();
    await expect(f.resourceAccess.api.originalInfrastructureOwnership(f.ids.own, 'unknown' as never)).rejects.toThrow('未登记');
    await f.db.db.execute(sql`UPDATE resource_access.changes SET body='{"private":"changed request"}'::jsonb WHERE id=${f.ids.own}`);
    expect(await f.resourceAccess.api.originalInfrastructureOwnership(f.ids.own)).toEqual(source);
    await f.db.db.execute(sql`UPDATE resource_access.deletion_identities SET project_id=${f.other.id} WHERE id=${f.ids.own}`);
    await expect(f.resourceAccess.api.originalInfrastructureOwnership(f.ids.own)).rejects.toMatchObject({ kind: 'precondition' });
  });
  test('升级保留申请；盘点包含理由与快照的完整摘要但不暴露原文，全局目录保留', async () => {
    f = await resourceAccessDeletionFixture(); const report = await f.resourceAccess.api.deletionOwner!.inspect(await f.project.api.deletionScope(f.own.id));
    expect(report.complete).toBe(true); expect(report.resources.find((r) => r.kind === 'changes')?.count).toBe(1);
    expect(JSON.stringify(report)).not.toContain('erase-owned-reason');
    expect([...(await f.db.db.execute(sql`SELECT body FROM resource_access.changes WHERE id=${f.ids.own}`))]).toEqual([{ body: { private: 'erase-owned-reason' } }]);
  });
  test('封写后迟到审批、删除与项目搬移都失败，提前元数据阶段及错 owner 拒绝', async () => {
    f = await resourceAccessDeletionFixture(); const started = await f.begin();
    expect((await f.resourceAccess.api.deletionOwner!.run(started.context)).kind).toBe('done');
    for (const query of [sql`UPDATE resource_access.changes SET state='approved' WHERE id=${f.ids.own}`, sql`DELETE FROM resource_access.changes WHERE id=${f.ids.own}`, sql`UPDATE resource_access.changes SET project_id=${f.other.id} WHERE id=${f.ids.own}`]) await expect(Promise.resolve(f.db.db.execute(query))).rejects.toMatchObject({ cause: { message: 'project resource requests are sealed for deletion' } });
    await expect(f.resourceAccess.api.deletionOwner!.run({ ...started.context, phase: 'metadata' })).rejects.toMatchObject({ kind: 'precondition' });
    await expect(f.resourceAccess.api.deletionOwner!.run({ ...started.context, confirmed: started.plan.participants.find((p) => p.participant === 'scm')! })).rejects.toMatchObject({ kind: 'precondition' });
  });
  test('清完超过一页的所有历史及快照，重复稳定；其他项目和目录不变，根消失后原 ID 不能换项目复活', async () => {
    f = await resourceAccessDeletionFixture();
    const original = await f.resourceAccess.api.originalInfrastructureOwnership(f.ids.own);
    const extra = Array.from({ length: 1501 }, () => ({ id: newResourceId(), key: newResourceId() }));
    await f.db.db.execute(sql`INSERT INTO resource_access.changes SELECT id,${f.own.id},${f.admin.userId},key,id,'rejected',1,'{"private":"erase-history"}'::jsonb,now() FROM jsonb_to_recordset(${JSON.stringify(extra)}::jsonb) AS rows(id text,key text)`);
    const started = await f.begin(); expect(started.context.confirmed.resources.find((r) => r.kind === 'changes')?.count).toBe(1502);
    for (const phase of PROJECT_DELETION_PHASES) for (const participant of [...PROJECT_DELETION_PARTICIPANTS.filter((p) => p !== 'project'), 'project' as const]) {
      const owner = participant === 'resource-access' ? f.resourceAccess.api.deletionOwner : participant === 'project' ? f.project.api.deletionOwner : undefined;
      const context = { ...started.context, phase, confirmed: started.plan.participants.find((p) => p.participant === participant)! };
      const step = owner ? await owner.run(context) : { kind: 'done' as const, evidence: { kind: 'not-applicable' as const, digest: jsonHash({ participant, phase }), description: '其他 owner 空范围，仅用于本模块许可测试', count: 0 } };
      expect(step.kind).toBe('done'); if (step.kind !== 'done') throw new Error('Module cleanup blocked');
      if (participant === 'resource-access' && phase === 'metadata') expect(await owner!.run(context)).toEqual(step);
      await f.project.api.recordProjectDeletionReceipt(started.lease, participant, phase, step.evidence);
    }
    expect((await f.project.api.completeProjectDeletion(started.lease)).state).toBe('succeeded');
    expect(await f.resourceAccess.api.originalInfrastructureOwnership(f.ids.own)).toEqual(original);
    for (const query of [sql`UPDATE resource_access.deletion_identities SET project_id=${f.other.id} WHERE id=${f.ids.own}`, sql`DELETE FROM resource_access.deletion_identities WHERE id=${f.ids.own}`, sql`TRUNCATE resource_access.deletion_identities`]) {
      await expect(Promise.resolve(f.db.db.execute(query))).rejects.toMatchObject({ cause: { message: 'resource request original identity is immutable' } });
      expect(await f.resourceAccess.api.originalInfrastructureOwnership(f.ids.own)).toEqual(original);
    }
    expect((await f.resourceAccess.api.originalInfrastructureOwnership(f.ids.other))?.projectIds).toEqual([f.other.id]);
    expect((await f.resourceAccess.api.deletionOwner!.inspect(started.context.target)).resources.every((r) => r.count === 0)).toBe(true);
    expect([...(await f.db.db.execute(sql`SELECT body FROM resource_access.changes WHERE id=${f.ids.other}`))]).toEqual([{ body: { private: 'retain-other-reason' } }]);
    expect((await f.db.db.execute(sql`SELECT key FROM resource_access.catalog_policies`)).map((r) => r.key)).toEqual([f.ids.policy]);
    await expect(Promise.resolve(f.db.db.execute(sql`INSERT INTO resource_access.changes VALUES (${f.ids.own},${f.other.id},${f.admin.userId},${newResourceId()},'late','pending',1,'{}',now())`))).rejects.toMatchObject({ cause: { message: 'resource request identity ownership is immutable' } });
  });
  test('内容变化不会通过重试冒充 seal 成功；未知表拒绝虚假的完整盘点', async () => {
    f = await resourceAccessDeletionFixture(); const started = await f.begin();
    await f.db.db.execute(sql`UPDATE resource_access.changes SET body='{"late":"content"}' WHERE id=${f.ids.own}`);
    for (let attempt = 0; attempt < 2; attempt++) expect(await f.resourceAccess.api.deletionOwner!.run(started.context)).toMatchObject({ kind: 'blocked', blockers: [{ code: 'inventory-changed' }] });
    await f.db.db.execute('CREATE TABLE resource_access.unknown_content(project_id text)');
    try { await expect(f.resourceAccess.api.deletionOwner!.inspect(started.context.target)).rejects.toMatchObject({ kind: 'precondition' }); }
    finally { await f.db.db.execute('DROP TABLE resource_access.unknown_content'); }
  });
  test('申请材料变化的持久失败，经原操作的新完整盘点与明确确认恢复；旧许可继续拒绝', async () => {
    f = await resourceAccessDeletionFixture(); const started = await f.begin();
    await f.db.db.execute(sql`UPDATE resource_access.changes SET body='{"late":"reviewed-content"}' WHERE id=${f.ids.own}`);
    expect((await f.resourceAccess.api.deletionOwner!.run(started.context)).kind).toBe('blocked');
    await f.project.api.blockProjectDeletion(started.lease, [{ participant: 'resource-access', code: 'inventory-changed', message: '实际应用或申请材料变化' }]);
    const report = await f.resourceAccess.api.deletionOwner!.inspect(await f.project.api.deletionScope(f.own.id));
    const reports = started.plan.participants.map((r) => r.participant === 'resource-access' ? report : r);
    const plan = await f.project.api.prepareProjectDeletionReconfirmation(f.admin, started.operation.id, reports);
    await f.project.api.reconfirmProjectDeletion(f.admin, started.operation.id, { planId: plan.id, requestKey: newResourceId(), confirm: 'delete' }, reports);
    const claimed = (await f.project.api.claimProjectDeletion(started.operation.id, 'request-reconfirmation'))!;
    await expect(f.resourceAccess.api.deletionOwner!.run({ ...started.context, generation: claimed.lease.generation })).rejects.toMatchObject({ kind: 'precondition' });
    const context = { ...started.context, generation: claimed.lease.generation, target: plan.target, confirmed: plan.participants.find((p) => p.participant === 'resource-access')! };
    expect((await f.resourceAccess.api.deletionOwner!.run(context)).kind).toBe('done');
    expect([...(await f.db.db.execute(sql`SELECT scope_verified FROM resource_access.deletion_fences WHERE project_id=${f.own.id}`))]).toEqual([{ scope_verified: true }]);
  });
});
