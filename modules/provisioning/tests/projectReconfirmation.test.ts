import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { PROJECT_DELETION_PARTICIPANTS, ProjectDeletionOperationSchema, ProjectDeletionPlanSchema } from '@crewstation/contracts';
import type { ProjectDeletionInventory } from '@crewstation/contracts';
import { jsonHash, newId } from '@crewstation/kernel';
import { testDatabaseAvailable } from '@crewstation/testkit';
import type { DeletionFixture } from './deletionFixture';
import { deletionFixture } from './deletionFixture';

const available = await testDatabaseAvailable(); let f: DeletionFixture;
beforeAll(async () => { if (available) f = await deletionFixture(); });
afterAll(async () => { await f?.database.drop(); });
async function pause() {
  const started = await f.start(), claimed = (await f.api.claimProjectDeletion(started.operation.id, 'reconfirm-test'))!;
  const context = { operationId: started.operation.id, generation: claimed.lease.generation, target: started.plan.target,
    phase: 'seal' as const, confirmed: started.plan.participants.find((p) => p.participant === 'project')! };
  const proof = await f.api.deletionOwner.run(context); if (proof.kind !== 'done') throw new Error('project seal missing');
  await f.api.recordProjectDeletionReceipt(claimed.lease, 'project', 'seal', proof.evidence);
  await f.api.blockProjectDeletion(claimed.lease, [{ participant: 'api-catalog', code: 'inventory-changed', message: '测试中的确认材料变化' }]);
  return { ...started, context, lease: claimed.lease };
}
describe.skipIf(!available)('封闭期间的重新确认（真实 PG，外部对象为编排替身）', () => {
  // 完整 owner 清理包含数百次真实 PG 事务，与 projectDeletion 同类流程采用 15 秒预算；不改变任何证明断言。
  test('普通继续不更新摘要；新确认保留原操作及已封闭证明，原许可失效，所有确认可跨删根重放', async () => {
    const started = await pause(), before = await f.api.readProjectDeletion(f.admin, started.operation.id);
    expect((await f.controller.retry(f.admin, started.operation.id)).confirmationDigest).toBe(before.confirmationDigest);
    const retried = (await f.api.claimProjectDeletion(started.operation.id, 'retry-test'))!;
    await f.api.blockProjectDeletion(retried.lease, [{ participant: 'api-catalog', code: 'inventory-changed', message: '继续仍使用原材料' }]);
    f.external.state('api-catalog', started.value.id).uid = 'new-api-content-fingerprint';
    const plan = await f.controller.prepareReconfirmation(f.admin, started.operation.id), input = f.input(plan);
    expect(plan).toMatchObject({ operationId: started.operation.id, supersedes: before.confirmationDigest, complete: true });
    expect(plan.digest).not.toBe(before.confirmationDigest);
    const renewed = await f.controller.reconfirm(f.admin, started.operation.id, input);
    expect(renewed).toMatchObject({ id: before.id, state: 'accepted', confirmationDigest: plan.digest, receipts: before.receipts });
    expect(renewed.confirmations).toHaveLength(2);
    expect((await f.api.getProject(f.admin, started.value.id)).state).toBe('deleting');
    await expect(f.api.deletionOwner.run(started.context)).rejects.toMatchObject({ kind: 'precondition' });
    await f.controller.advance(renewed.id);
    const done = await f.controller.read(f.admin, renewed.id); expect(done.state).toBe('succeeded');
    expect(done.receipts.filter((r) => r.participant === 'project' && r.phase === 'seal')).toEqual(before.receipts);
    expect(await f.controller.accept(f.admin, started.value.id, started.request)).toEqual(done);
    expect(await f.controller.reconfirm(f.admin, renewed.id, input)).toEqual(done);
    expect(await f.database.db.execute(`SELECT id FROM project.deletion_plans WHERE project_id='${started.value.id}'`)).toHaveLength(0);
  }, 15_000);
  test('真实管理员与严格 delete 确认；HTTP 新路由有成功、拒绝、位置与 no-store 证据', async () => {
    const started = await pause(), base = `/v1/project-deletions/${started.operation.id}`;
    for (const suffix of ['/reconfirmation-plans', '/reconfirm']) {
      expect((await f.call(`${base}${suffix}`, 'POST', {}, null)).status).toBe(401);
      expect((await f.call(`${base}${suffix}`, 'POST', {}, { ...f.member, isAdmin: true })).status).toBe(403);
    }
    expect((await f.call(`${base}/reconfirmation-plans`, 'POST', { resources: [] })).status).toBe(400);
    const response = await f.call(`${base}/reconfirmation-plans`, 'POST', {});
    expect(response.status).toBe(200); expect(response.headers.get('cache-control')).toBe('no-store');
    const plan = ProjectDeletionPlanSchema.parse(await response.json()), input = f.input(plan);
    expect((await f.call(`${base}/reconfirm`, 'POST', { ...input, confirm: 'yes' })).status).toBe(400);
    const accepted = await f.call(`${base}/reconfirm`, 'POST', input);
    expect(accepted.status).toBe(202); expect(accepted.headers.get('location')).toBe(base);
    expect(ProjectDeletionOperationSchema.parse(await accepted.json())).toMatchObject({ id: started.operation.id, confirmationDigest: plan.digest });
    expect((await f.call(`/v1/project-deletions/${newId('missing')}/reconfirmation-plans`, 'POST', {})).status).toBe(404);
  });
  test('受理、在途与已进入 stop 的操作不能换范围；原物理 UID 替换不能借重新确认认领', async () => {
    const started = await f.start();
    await expect(f.controller.prepareReconfirmation(f.admin, started.operation.id)).rejects.toMatchObject({ kind: 'conflict' });
    const claimed = (await f.api.claimProjectDeletion(started.operation.id, 'active-test'))!;
    await expect(f.controller.prepareReconfirmation(f.admin, started.operation.id)).rejects.toMatchObject({ kind: 'conflict' });
    for (const participant of PROJECT_DELETION_PARTICIPANTS) await f.api.recordProjectDeletionReceipt(claimed.lease, participant, 'seal', { kind: 'metadata', digest: jsonHash(participant), description: '编排门禁测试证明', count: 0 });
    await f.api.blockProjectDeletion(claimed.lease, [{ participant: 'data', code: 'offline', message: 'stop 期间来源不可读' }]);
    await expect(f.controller.prepareReconfirmation(f.admin, started.operation.id)).rejects.toMatchObject({ kind: 'conflict' });
    for (const participant of ['cluster-control', 'data', 'scm'] as const) {
      const physical = await pause(); f.external.state(participant, physical.value.id).uid = 'replacement-source-identity';
      const plan = await f.controller.prepareReconfirmation(f.admin, physical.operation.id);
      expect(plan.complete).toBe(false); expect(plan.blockers.some((b) => b.code === 'original-identity-changed')).toBe(true);
      await expect(f.controller.reconfirm(f.admin, physical.operation.id, f.input(plan))).rejects.toMatchObject({ kind: 'precondition' });
    }
  });
  test('物理来源锚点保持时可确认新修订，但来源身份不能降级成可替换的内容摘要', async () => {
    const started = await pause(), reports = await Promise.all(f.external.owners.map((o) => o.inspect(started.plan.target)));
    const revised = reports.map((r) => r.participant === 'data' ? { ...r, revision: jsonHash('new-material'), resources: r.resources.map((resource) => ({ ...resource, identity: jsonHash('new-specification') })) } : r);
    const plan = await f.api.prepareProjectDeletionReconfirmation(f.admin, started.operation.id, revised);
    expect(plan.complete).toBe(true); expect(plan.participants.find((r) => r.participant === 'data')?.resources[0]?.sourceIdentity).toBe(f.external.state('data', started.value.id).uid);
    const downgraded = revised.map((r) => r.participant === 'data' ? { ...r, resources: r.resources.map((resource) => ({ ...resource, scope: 'metadata' as const })) } : r);
    const invalid = await f.api.prepareProjectDeletionReconfirmation(f.admin, started.operation.id, downgraded);
    expect(invalid.complete).toBe(false); expect(invalid.blockers.some((b) => b.code === 'original-identity-changed')).toBe(true);
  });
  test('不完整来源、已封闭资源数量变化、过期或确认后变化均不能更新原确认', async () => {
    const started = await pause(); f.external.unavailable.add('data');
    try {
      const plan = await f.controller.prepareReconfirmation(f.admin, started.operation.id); expect(plan.complete).toBe(false);
      await expect(f.controller.reconfirm(f.admin, started.operation.id, f.input(plan))).rejects.toMatchObject({ kind: 'precondition' });
    } finally { f.external.unavailable.delete('data'); }
    const current = await f.api.readProjectDeletion(f.admin, started.operation.id), reports = await Promise.all(f.external.owners.map((o) => o.inspect(started.plan.target)));
    const changed: ProjectDeletionInventory[] = reports.map((r) => r.participant === 'project' ? { ...r, resources: [...r.resources, { kind: 'new-content', id: started.value.id, identity: jsonHash('late'), count: 1 }], revision: jsonHash('late') } : r);
    const blocked = await f.api.prepareProjectDeletionReconfirmation(f.admin, started.operation.id, changed);
    expect(blocked.blockers.some((b) => b.code === 'sealed-scope-changed')).toBe(true);
    const expired = await f.controller.prepareReconfirmation(f.admin, started.operation.id); f.elapse(600_001);
    await expect(f.controller.reconfirm(f.admin, started.operation.id, f.input(expired))).rejects.toMatchObject({ kind: 'conflict' });
    const fresh = await f.controller.prepareReconfirmation(f.admin, started.operation.id); f.external.state('api-catalog', started.value.id).uid = 'changed-after-plan';
    await expect(f.controller.reconfirm(f.admin, started.operation.id, f.input(fresh))).rejects.toMatchObject({ kind: 'conflict' });
    expect((await f.api.readProjectDeletion(f.admin, started.operation.id)).confirmationDigest).toBe(current.confirmationDigest);
  });
  test('请求键跨初次与更新全局保护；并发管理员同材料重放，异操作不能占用同键', async () => {
    const first = await pause(), second = await pause();
    const plan = await f.controller.prepareReconfirmation(f.admin, first.operation.id), other = await f.controller.prepareReconfirmation(f.admin, second.operation.id);
    await expect(f.controller.reconfirm(f.admin, second.operation.id, { ...f.input(other), requestKey: first.request.requestKey })).rejects.toMatchObject({ kind: 'conflict' });
    const input = f.input(plan), results = await Promise.all([f.controller.reconfirm(f.admin, first.operation.id, input), f.controller.reconfirm(f.admin, first.operation.id, input)]);
    expect(results[0]).toEqual(results[1]); expect(results[0]!.confirmations).toHaveLength(2);
    await expect(f.controller.reconfirm(f.admin, first.operation.id, { ...input, planId: other.id })).rejects.toMatchObject({ kind: 'conflict' });
    await expect(f.controller.reconfirm(f.admin, second.operation.id, { ...f.input(other), requestKey: input.requestKey })).rejects.toMatchObject({ kind: 'conflict' });
    const third = await pause(), fourth = await pause(), one = await f.controller.prepareReconfirmation(f.admin, third.operation.id), two = await f.controller.prepareReconfirmation(f.admin, fourth.operation.id);
    const sharedKey = newId('request'), competing = await Promise.allSettled([f.controller.reconfirm(f.admin, third.operation.id, { ...f.input(one), requestKey: sharedKey }), f.controller.reconfirm(f.admin, fourth.operation.id, { ...f.input(two), requestKey: sharedKey })]);
    expect(competing.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    const refused = competing.find((r) => r.status === 'rejected'); expect(refused?.status === 'rejected' ? refused.reason : undefined).toMatchObject({ kind: 'conflict' });
  });
  test('outbox 失败回滚整笔重新确认，原摘要、证明和 deleting 均保留', async () => {
    const started = await pause(), before = await f.api.readProjectDeletion(f.admin, started.operation.id), plan = await f.controller.prepareReconfirmation(f.admin, started.operation.id);
    await f.database.db.execute(`CREATE FUNCTION platform_infra.reject_reconfirmation() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.topic='project.deletion-requested' THEN RAISE EXCEPTION 'reconfirmation outbox unavailable'; END IF; RETURN NEW; END $$`);
    await f.database.db.execute('CREATE TRIGGER reject_reconfirmation BEFORE INSERT ON platform_infra.domain_events FOR EACH ROW EXECUTE FUNCTION platform_infra.reject_reconfirmation()');
    try { await expect(f.controller.reconfirm(f.admin, started.operation.id, f.input(plan))).rejects.toThrow(); }
    finally { await f.database.db.execute('DROP TRIGGER reject_reconfirmation ON platform_infra.domain_events'); await f.database.db.execute('DROP FUNCTION platform_infra.reject_reconfirmation()'); }
    expect(await f.api.readProjectDeletion(f.admin, started.operation.id)).toEqual(before);
    expect((await f.api.getProject(f.admin, started.value.id)).state).toBe('deleting');
  });
});
