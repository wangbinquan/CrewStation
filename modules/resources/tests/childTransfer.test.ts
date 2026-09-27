import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { testDatabaseAvailable } from '@crewstation/testkit';
import { createHarness, OTHER_PROJECT, PROJECT, workspace } from './fixtures';
import type { Harness } from './fixtures';

const available = await testDatabaseAvailable();
describe.skipIf(!available)('开发预览子对象的原子移交（RFC-025 T9）', () => {
  let h: Harness;
  beforeAll(async () => { h = await createHarness(); });
  afterAll(async () => { await h.database.drop(); });
  const setup = async (suffix: string) => {
    const owner = h.module.api.owner('task-runtime');
    const child = { kind: 'IngressRoute', namespace: 'cs-demo', name: `preview-${suffix}` };
    const original = await owner.declare(workspace(suffix, { spec: { children: [child] } }));
    await h.module.api.observe({ child: { ...child, uid: `uid-${suffix}`, phase: 'Present', ready: true } });
    const input = { kind: 'route' as const, ref: `${suffix}/preview`, projectId: PROJECT, parentId: original.id, spec: { children: [child], host: 'dev.demo.localhost' } };
    return { owner, child, original, input };
  };
  test('同事务转移期望与观测，旧记录不再认领，UID 保留；重放不空写', async () => {
    const { owner, child, original, input } = await setup('move');
    const route = await owner.splitChildren(original.id, input);
    expect(await h.module.api.claimOf(child)).toBe(route.id);
    const source = (await h.module.api.get(original.id))!;
    expect(source.spec.children).toEqual([]);
    expect(source.children).toEqual([]);
    expect(route.children).toEqual([expect.objectContaining({ uid: 'uid-move', phase: 'Present' })]);
    expect((await owner.splitChildren(original.id, input)).version).toBe(route.version);
    await owner.requestRelease(original.id, { code: 'user', message: '用户释放' });
    expect((await h.module.api.get(route.id))?.children[0]?.uid).toBe('uid-move');
  });
  test('调和器持有旧记录或路由租约时拒绝移交，整笔保持不变，释放租约后可以重试', async () => {
    const { owner, child, original, input } = await setup('busy');
    for (const lease of [original.id, 'route-arbitration']) {
      expect(await h.module.api.leases.acquire(lease, 'controller', 30_000)).toBe(true);
      await expect(owner.splitChildren(original.id, input)).rejects.toMatchObject({ kind: 'conflict' });
      expect(await h.module.api.claimOf(child)).toBe(original.id);
      expect(await owner.find(input.ref, 'route')).toBeUndefined();
      await h.module.api.leases.release(lease, 'controller');
    }
    expect((await owner.splitChildren(original.id, input)).kind).toBe('route');
  });
  test('拒绝跨模块、跨项目、错误上级与非路由移交', async () => {
    const { owner, original, input } = await setup('invalid');
    await expect(h.module.api.owner('gateway').splitChildren(original.id, input)).rejects.toMatchObject({ kind: 'forbidden' });
    for (const patch of [{ projectId: OTHER_PROJECT }, { parentId: 'another' }, { kind: 'volume' as const }]) {
      await expect(owner.splitChildren(original.id, { ...input, ...patch })).rejects.toMatchObject({ kind: 'validation' });
    }
  });
  test('目标声明失败时旧认领仍在，不能偷走第三条记录的对象', async () => {
    const { owner, child, original, input } = await setup('occupied');
    const foreignChild = { ...child, name: 'foreign' };
    const other = await owner.declare(workspace('foreign', { spec: { children: [foreignChild] } }));
    await expect(owner.splitChildren(original.id, { ...input, spec: { children: [child, foreignChild] } })).rejects.toMatchObject({ kind: 'conflict' });
    expect(await h.module.api.claimOf(child)).toBe(original.id);
    expect(await h.module.api.claimOf(foreignChild)).toBe(other.id);
  });
});

describe.skipIf(!available)('预览路由跟随工作区释放', () => {
  test('普通释放和保留期到期在同一事务释放明确声明随父回收的路由，不影响其他子资源', async () => {
    const h = await createHarness();
    try {
      const owner = h.module.api.owner('task-runtime');
      const source = await owner.declare(workspace('release-preview'));
      const route = await owner.declare({ kind: 'route', ref: 'release-preview/preview', projectId: PROJECT, parentId: source.id, spec: { children: [], releaseWithParent: true } });
      const retained = await owner.declare({ kind: 'volume', ref: 'release-preview/work', projectId: PROJECT, parentId: source.id, spec: { children: [], reclaim: 'retain' } });
      await owner.requestRelease(source.id, { code: 'user', message: '用户释放' });
      expect(await h.module.api.get(route.id)).toMatchObject({ desired: 'absent', releaseReason: { code: 'user' } });
      expect((await h.module.api.get(retained.id))?.desired).toBe('present');
    } finally { await h.database.drop(); }
  });
});
