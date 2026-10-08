import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import type { ProjectDeletionTarget } from '@crewstation/contracts';
import { createIdentityModule } from '@crewstation/module-identity';
import { jsonHash, noopLogger } from '@crewstation/kernel';
import { testDatabaseAvailable } from '@crewstation/testkit';
import { projectDeletionController } from '../application/deletion/controller';
import type { DeletionFixture } from './deletionFixture';
import { deletionFixture } from './deletionFixture';

const available = await testDatabaseAvailable(); let f: DeletionFixture;
beforeAll(async () => { if (available) f = await deletionFixture(); });
afterAll(async () => { await f?.database.drop(); });

async function blocked() {
  const started = await f.start();
  const claimed = await f.api.claimProjectDeletion(started.operation.id, 'reconfirmation-test');
  await f.api.blockProjectDeletion(claimed!.lease, [{ participant: 'gateway', code: 'changed', message: '原封闭来源需要重新核对' }]);
  const original = await f.controller.read(f.admin, started.operation.id);
  expect(original).toMatchObject({ state: 'needs-attention', phase: 'seal' });
  const plan = await f.controller.prepareReconfirmation(f.admin, original.id);
  expect(plan.complete).toBe(true);
  return { ...started, original, plan, input: f.input(plan) };
}
function inspecting(before: (participant: string) => void | Promise<void>) {
  const owners = f.external.owners.map(owner => ({ ...owner, inspect: async (target: ProjectDeletionTarget) => {
    await before(owner.participant); return owner.inspect(target);
  } }));
  return projectDeletionController({ intents: f.intents, owners, isAdmin: async id => id === f.admin.userId,
    workerOwner: 'reconfirmation-test', logger: noopLogger, enqueue: async id => { f.queued.push(id); } });
}

describe.skipIf(!available)('原操作重新确认的受理时限（真实 PG）', () => {
  test('管理员及时提交后，完整核对跨过计划期限仍绑定原确认；核对完成前没有停止或清理', async () => {
    const current = await blocked(), before = f.external.calls.length;
    const slow = inspecting(participant => { if (participant === 'data') f.elapse(600_001); });
    // The live reconfirmation collects every owner before checking expiry; a ten-minute scan must not expire an already submitted confirmation.
    const result = await slow.reconfirm(f.admin, current.original.id, current.input);
    expect(result).toMatchObject({ id: current.original.id, state: 'accepted', phase: 'seal', confirmationDigest: current.plan.digest });
    const confirmation = result.confirmations!.find(row => row.planId === current.plan.id)!;
    expect(confirmation.requestKey).toBe(current.input.requestKey);
    expect(Date.parse(confirmation.confirmedAt)).toBeLessThan(Date.parse(current.plan.expiresAt));
    expect(Date.parse(result.updatedAt)).toBeGreaterThan(Date.parse(current.plan.expiresAt));
    expect(f.external.calls).toHaveLength(before);
    expect(f.external.state('resources', current.value.id)).toMatchObject({ exists: true, storage: true, running: true });
  });

  test('提交时已经过期的计划在执行来源核对前拒绝，保留原操作与资源', async () => {
    const current = await blocked(); let inspections = 0;
    const controller = inspecting(() => { inspections++; }); f.elapse(600_001);
    await expect(controller.reconfirm(f.admin, current.original.id, current.input)).rejects.toMatchObject({ kind: 'conflict', details: {
      code: 'project_deletion_confirmation_rejected', planId: current.input.planId, requestKey: current.input.requestKey,
    } });
    expect(inspections).toBe(0);
    expect(await f.controller.read(f.admin, current.original.id)).toEqual(current.original);
    expect(f.external.state('resources', current.value.id)).toMatchObject({ exists: true, storage: true, running: true });
  });

  test('及时提交仍完整核对资源身份；来源变化或不可读拒绝且保留原确认', async () => {
    for (const unavailable of [false, true]) {
      const current = await blocked(), before = f.external.calls.length;
      const changed = inspecting(participant => {
        if (participant === 'resources') {
          f.elapse(600_001);
          if (unavailable) f.external.unavailable.add('resources');
          else f.external.state('resources', current.value.id).uid = 'changed-during-original-reconfirmation';
        }
      });
      try {
        await expect(changed.reconfirm(f.admin, current.original.id, current.input)).rejects.toMatchObject({ kind: 'precondition' });
        expect(await f.controller.read(f.admin, current.original.id)).toEqual(current.original);
        expect(f.external.calls).toHaveLength(before);
      } finally { f.external.unavailable.delete('resources'); }
    }
  });

  test('已接受的同键重放跨过有效期仍返回原回执，非管理员不调用盘点来源', async () => {
    const current = await blocked(); let inspections = 0;
    const accepted = await f.controller.reconfirm(f.admin, current.original.id, current.input); f.elapse(600_001);
    const controller = inspecting(() => { inspections++; });
    expect(await controller.reconfirm(f.admin, current.original.id, current.input)).toEqual(accepted);
    const source = async () => { inspections++; return []; };
    expect(await f.api.reconfirmProjectDeletion(f.admin, current.original.id, current.input, source)).toEqual(accepted);
    await expect(controller.reconfirm({ ...f.member, isAdmin: true }, current.original.id, current.input)).rejects.toMatchObject({ kind: 'forbidden' });
    await expect(f.api.reconfirmProjectDeletion({ ...f.member, isAdmin: true }, current.original.id, current.input, source)).rejects.toMatchObject({ kind: 'forbidden' });
    expect(inspections).toBe(0);
  });

  test('原计划和操作不匹配在核对前拒绝，两个原操作均保留', async () => {
    const first = await blocked(), second = await blocked(); let inspections = 0;
    const controller = inspecting(() => { inspections++; });
    await expect(controller.reconfirm(f.admin, first.original.id, second.input)).rejects.toMatchObject({ kind: 'conflict' });
    expect(inspections).toBe(0);
    expect(await f.controller.read(f.admin, first.original.id)).toEqual(first.original);
    expect(await f.controller.read(f.admin, second.original.id)).toEqual(second.original);
  });

  test('盘点期间撤销真实管理员资格会拒绝受理；来源读取期间不持有角色锁', async () => {
    const current = await blocked(); let revoked = false;
    const identity = createIdentityModule({ db: f.database.db, settings: { adminEmails: [] } }).api;
    const second = await identity.ensureUser({ externalId: 'admission-second-admin', name: 'Second Admin', email: 'admission-second-admin@test.invalid' });
    await identity.setPlatformRole(second.id, { expectedRole: 'user', platformRole: 'admin' });
    const controller = inspecting(async participant => {
      if (participant === 'data') {
        await identity.setPlatformRole(f.admin.userId, { expectedRole: 'admin', platformRole: 'user' }); revoked = true;
      }
    });
    try { await expect(controller.reconfirm(f.admin, current.original.id, current.input)).rejects.toMatchObject({ kind: 'forbidden' }); }
    finally { if (revoked) await identity.setPlatformRole(f.admin.userId, { expectedRole: 'user', platformRole: 'admin' }); }
    expect(revoked).toBe(true);
    expect(await f.controller.read(f.admin, current.original.id)).toEqual(current.original);
    expect(f.external.state('resources', current.value.id)).toMatchObject({ exists: true, storage: true, running: true });
  });

  test('原物理身份保持也需完整摘要相同，及时确认不能接受盘点期间变化的来源', async () => {
    const current = await blocked(), before = f.external.calls.length;
    const owners = f.external.owners.map(owner => ({ ...owner, inspect: async (target: ProjectDeletionTarget) => {
      const report = await owner.inspect(target);
      if (owner.participant !== 'data') return report;
      f.elapse(600_001); return { ...report, revision: jsonHash('actual-source-revision-changed') };
    } }));
    const controller = projectDeletionController({ intents: f.intents, owners, isAdmin: async id => id === f.admin.userId,
      workerOwner: 'reconfirmation-test', logger: noopLogger, enqueue: async () => {} });
    await expect(controller.reconfirm(f.admin, current.original.id, current.input)).rejects.toMatchObject({ kind: 'conflict', message: '重新确认材料又发生变化，请重新盘点' });
    expect(await f.controller.read(f.admin, current.original.id)).toEqual(current.original);
    expect(f.external.calls).toHaveLength(before);
  });
});
