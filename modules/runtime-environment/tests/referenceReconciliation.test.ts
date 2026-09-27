import { afterEach, describe, expect, test } from 'bun:test';
import { newResourceId } from '@crewstation/kernel';
import { testDatabaseAvailable } from '@crewstation/testkit';
import { runtimeImageFixture, type RuntimeImageFixture } from './runtimeImageFixture';
import { builtVersion, passedValidation } from './versionFixture';
import type { RuntimeImageReferenceOwners } from '../ports/referenceOwners';

const available = await testDatabaseAvailable();
describe.skipIf(!available)('镜像引用仅按所有者稳定终态回收', () => {
  let f: RuntimeImageFixture;
  afterEach(async () => { await f?.tdb.drop(); });
  async function fixture(inspect?: RuntimeImageReferenceOwners['inspect']) {
    f = await runtimeImageFixture(undefined, undefined, undefined, inspect ? { inspect } : undefined);
    const version = await builtVersion(f); await passedValidation(f, version.id);
    const reserve = async () => {
      const owner = { type: 'task' as const, id: newResourceId() };
      await f.api.reserveImage(f.developer, f.project, { selection: { runtimeImageVersionId: version.id }, target: { usage: 'task' }, owner });
      return owner;
    };
    return { version, reserve };
  }
  test('过期不是释放证明：active、unknown、查询失败保留，released 才删除', async () => {
    const proof = new Map<string, 'active' | 'released' | 'unknown'>(), inspected: string[] = [];
    const { version, reserve } = await fixture(async (input) => {
      expect(input.projectId).toBe(f.project); expect(input.versionId).toBe(version.id); inspected.push(input.ownerId);
      const state = proof.get(input.ownerId); if (!state) throw new Error('owner unavailable'); return state;
    });
    const active = await reserve(), released = await reserve(), unknown = await reserve(), unavailable = await reserve();
    proof.set(active.id, 'active'); proof.set(released.id, 'released'); proof.set(unknown.id, 'unknown');
    f.advance(3600001); const young = await reserve(); proof.set(young.id, 'released');
    expect(await f.api.reconcileReferences()).toBe(1);
    expect(new Set((await f.uow.read.references.list(version.id)).map((r) => r.ownerId))).toEqual(new Set([active.id, unknown.id, unavailable.id, young.id]));
    expect(inspected).not.toContain(young.id);
  });
  test('没有所有者端口时不释放，即使租约已到期', async () => {
    const { version, reserve } = await fixture(); const owner = await reserve(); f.advance(3600001);
    expect(await f.api.reconcileReferences()).toBe(0);
    expect(await f.uow.read.references.get(version.id, owner.type, owner.id)).toBeDefined();
  });
  test('查询期间并发确认使旧回收候选失效', async () => {
    const { version, reserve } = await fixture(async (input) => {
      await f.api.confirmReference(input.versionId, { type: 'task', id: input.ownerId }); return 'released';
    });
    const owner = await reserve(); f.advance(3600001);
    expect(await f.api.reconcileReferences()).toBe(0);
    expect(await f.uow.read.references.get(version.id, owner.type, owner.id)).toMatchObject({ state: 'confirmed' });
  });
  test('有界游标不会被未结束引用挡住后续已结束引用', async () => {
    let releasable = '';
    const { version, reserve } = await fixture(async (input) => input.ownerId === releasable ? 'released' : 'active');
    for (let i = 0; i < 21; i++) { const owner = await reserve(); await f.api.confirmReference(version.id, owner); releasable = owner.id; }
    expect(await f.api.reconcileReferences()).toBe(0);
    expect(await f.api.reconcileReferences()).toBe(1);
    expect(await f.api.reconcileReferences()).toBe(0);
    expect(await f.uow.read.references.list(version.id)).toHaveLength(20);
  });
});
