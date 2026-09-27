import { describe, expect, test } from 'bun:test';
import { testDatabaseAvailable } from '@crewstation/testkit';
import { ADMIN, createHarness, DEVELOPER, PROJECT, workspace } from './fixtures';

const available = await testDatabaseAvailable(), ns = 'cs-demo';
async function fixture() {
  const h = await createHarness(), api = h.module.api;
  const record = await api.owner('provisioning').declare({ kind: 'namespace', ref: PROJECT, projectId: PROJECT, spec: { children: [{ kind: 'Namespace', name: ns }, { kind: 'ResourceQuota', name: 'quota', namespace: ns }] } });
  await api.observe({ child: { kind: 'Namespace', name: ns, uid: 'namespace-uid', phase: 'Active', ready: true } });
  await api.observe({ child: { kind: 'ResourceQuota', name: 'quota', namespace: ns, uid: 'quota-uid', phase: 'Present', ready: true } });
  const policy = await api.owner('provisioning').declare({ kind: 'network-policy-set', ref: PROJECT, projectId: PROJECT, spec: { children: [{ kind: 'NetworkPolicy', namespace: ns, name: 'default' }] } });
  await api.observe({ child: { kind: 'NetworkPolicy', name: 'default', namespace: ns, uid: 'policy-uid', phase: 'Present', ready: true } });
  return { ...h, api, record, policy, retire: (inspect = async () => {}) => api.retireNamespace(record.id, 'namespace-uid', inspect) };
}

describe.skipIf(!available)('管理员归档命名空间删除的原子受理', () => {
  test('同时释放命名空间、额度、网络策略及闲置 Service；不碰项目数据库；清理后与压缩后均阻止复活', async () => {
    const h = await fixture();
    try {
      const slot = await h.api.owner('release').declare({ kind: 'service-slot', ref: 'green', projectId: PROJECT, spec: { children: [{ kind: 'Service', name: 'green', namespace: ns }] }, conditions: [{ type: 'Serving', status: 'false' }] });
      await h.api.observe({ child: { kind: 'Service', name: 'green', namespace: ns, uid: 'service-uid', phase: 'Present', ready: true } });
      const database = await h.api.owner('data').declare({ kind: 'database', ref: 'database', projectId: PROJECT, spec: { children: [{ kind: 'PostgresDatabase', name: 'retained' }] } });
      let inspected = 0;
      await h.api.retireNamespace(h.record.id, 'namespace-uid', async (name, children) => {
        inspected++; expect(name).toBe(ns); expect(children.map((child) => child.kind).sort()).toEqual(['NetworkPolicy', 'ResourceQuota', 'Service']);
      });
      expect(inspected).toBe(1);
      for (const id of [h.record.id, h.policy.id, slot.id]) expect((await h.api.get(id))?.desired).toBe('absent');
      expect((await h.api.get(database.id))?.desired).toBe('present');
      await h.retire();
      await expect(h.api.owner('task-runtime').declare(workspace('after'))).rejects.toThrow('已受理删除');
      const namespace = (await h.api.get(h.record.id))!;
      for (const child of namespace.children) await h.api.observe({ child: { ...child, phase: 'absent', ready: false }, gone: true });
      h.clock.advance(8 * 24 * 3600_000); await h.module.maintainOnce();
      expect((await h.api.get(h.record.id))?.compactedAt).toBeDefined();
      await expect(h.api.owner('task-runtime').declare(workspace('after-compaction'))).rejects.toThrow('已受理删除');
    } finally { await h.database.drop(); }
  });
  test('有工作负载、保留卷、错误 UID 时不受理；盘点失败与租约竞争全部回滚', async () => {
    const h = await fixture();
    try {
      await expect(h.api.retireNamespace(h.record.id, 'wrong', async () => {})).rejects.toMatchObject({ kind: 'conflict' });
      await expect(h.api.retireNamespace('01a0bf5d-8f4b-7000-9e4b-b54e91ee9d10', 'missing', async () => {})).rejects.toMatchObject({ kind: 'not_found' });
      const task = await h.api.owner('task-runtime').declare(workspace('live'));
      await expect(h.retire()).rejects.toThrow('dev-workspace');
      await h.api.owner('task-runtime').requestRelease(task.id, { code: 'done', message: 'done' });
      const volume = await h.api.owner('task-runtime').declare({ kind: 'volume', ref: 'retained', projectId: PROJECT, spec: { children: [{ kind: 'PersistentVolumeClaim', namespace: ns, name: 'work' }] } });
      await h.api.observeConditions(volume.id, [{ type: 'PendingReclaim', status: 'true' }]);
      await expect(h.retire()).rejects.toThrow('volume');
      await h.api.owner('task-runtime').requestRelease(volume.id, { code: 'volume-deleted', message: 'confirmed' });
      await expect(h.retire(async () => { throw new Error('unowned CRD'); })).rejects.toThrow('unowned CRD');
      expect((await h.api.get(h.record.id))?.desired).toBe('present');
      expect((await h.api.get(h.policy.id))?.desired).toBe('present');
      expect(await h.api.leases.acquire(h.policy.id, 'other', 30000)).toBe(true);
      await expect(h.retire()).rejects.toMatchObject({ kind: 'conflict' });
      await h.api.leases.release(h.policy.id, 'other');
      await h.retire();
      for (const id of [h.record.id, h.policy.id, task.id, volume.id, 'route-arbitration']) expect(await h.api.leases.acquire(id, 'after', 30000)).toBe(true);
    } finally { await h.database.drop(); }
  });
  test('标准动作仅管理员可做；清理阻断作为阶段原因展示，重新检查通过才清除', async () => {
    const h = await fixture();
    try {
      h.api.registerActionHandler('provisioning', () => h.retire());
      await expect(h.api.performAction(DEVELOPER, h.record.id, 'delete-namespace', {})).rejects.toMatchObject({ kind: 'forbidden' });
      const result = await h.api.performAction(ADMIN, h.record.id, 'delete-namespace', {});
      expect(result.record?.actions).toEqual([{ id: 'delete-namespace', enabled: false, disabledReason: '已受理删除，正在回收' }]);
      await h.api.observeConditions(h.record.id, [{ type: 'CleanupBlocked', status: 'true', reason: 'unknown-resource', message: '请先处理未知对象' }]);
      expect(await h.api.get(h.record.id)).toMatchObject({ phase: 'stopping', reason: { code: 'unknown-resource', message: '请先处理未知对象' } });
      await expect(h.api.owner('provisioning').report(h.record.id, { conditions: [{ type: 'CleanupBlocked', status: 'false' }] })).rejects.toMatchObject({ kind: 'validation' });
      await h.api.observeConditions(h.record.id, [{ type: 'CleanupBlocked', status: 'false' }]);
      expect((await h.api.get(h.record.id))?.reason?.code).toBe('archived-namespace-deleted');
    } finally { await h.database.drop(); }
  });
});
