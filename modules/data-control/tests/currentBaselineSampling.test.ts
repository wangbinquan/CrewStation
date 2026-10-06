import { expect, test } from 'bun:test';
import { precondition } from '@crewstation/kernel';
import { testDatabaseAvailable } from '@crewstation/testkit';
import { postgresNativeDeletionPhysics } from '../adapters/postgres/databaseReclamation';
import { withNativePostgresNames } from '../adapters/postgres/nativeNames';
import type { NativeDeletionPlan } from '../ports/dataPlane';
import { nativeOwnerFixture, nativeOwnerUrl } from './nativeDeletionFixture';

const available = await testDatabaseAvailable();
type Fixture = Parameters<Parameters<typeof nativeOwnerFixture>[0]>[0];
async function originalPlan(f: Fixture): Promise<NativeDeletionPlan> {
  const storage = await withNativePostgresNames(nativeOwnerUrl, [f.name, f.role], (connection) => f.source.capture(connection));
  const catalog = (await f.catalog()).map((row) => ({ ...row, kind: row.kind as 'database' | 'role' }));
  return { keys: [f.origin.resourceId], names: catalog.map(({ kind, name }) => ({ kind, name })), catalog, sources: [storage], sessions: [] };
}
const busy = () => precondition('independent probe is sampling', { code: 'native_postgres_source_busy' });

test.skipIf(!available)('当前原生基线：采样暂忙后在同一原名字锁内核对完整 SQL／卷身份，不靠重读碰运气', () => nativeOwnerFixture(async (f) => {
  const plan = await originalPlan(f), before = await f.catalog(); let captures = 0, verifications = 0;
  const physics = postgresNativeDeletionPhysics({ adminUrl: nativeOwnerUrl, reader: f.module.api.databaseReclamation!, assertGrant: async () => undefined,
    source: { capture: async (connection) => { if (++captures === 1) throw busy(); return f.source.capture(connection); },
      verify: async (connection, original) => { if (++verifications === 1) throw busy(); return f.source.verify(connection, original); } } });
  // The installed probe's shared sampler returned 409 during both reading and saving the actual admin baseline.
  const scope = await physics.captureCurrent!(plan);
  expect(scope.databases.map(({ name, oid }) => ({ kind: 'database', name, oid }))).toEqual(before.filter((row) => row.kind === 'database'));
  expect(scope.roles.map(({ name, oid }) => ({ kind: 'role', name, oid }))).toEqual(before.filter((row) => row.kind === 'role'));
  expect(scope.storage?.identity).toBe(plan.sources[0]!.identity); expect(scope.plan.names).toEqual(plan.names);
  expect(await f.catalog()).toEqual(before); expect(captures).toBeGreaterThan(1); expect(verifications).toBeGreaterThan(1);
  expect(new Set(f.nativeGuards.slice(-3)).size).toBe(1);
}));

test.skipIf(!available)('当前原生基线：等待期间原卷替换仍阻断，不接受随后出现的当前实体', () => nativeOwnerFixture(async (f) => {
  const plan = await originalPlan(f), before = await f.catalog(); let verifications = 0;
  const physics = postgresNativeDeletionPhysics({ adminUrl: nativeOwnerUrl, reader: f.module.api.databaseReclamation!, assertGrant: async () => undefined,
    source: { capture: f.source.capture, verify: async (connection, original) => {
      if (++verifications === 1) { f.replaceSource(); throw busy(); } return f.source.verify(connection, original);
    } } });
  await expect(physics.captureCurrent!(plan)).rejects.toThrow('original volume replaced');
  expect(verifications).toBe(2); expect(await f.catalog()).toEqual(before);
}));

test.skipIf(!available)('当前原生基线：非采样错误立即返回，原库／角色不变', () => nativeOwnerFixture(async (f) => {
  const plan = await originalPlan(f), before = await f.catalog(); let attempts = 0;
  const physics = postgresNativeDeletionPhysics({ adminUrl: nativeOwnerUrl, reader: f.module.api.databaseReclamation!, assertGrant: async () => undefined,
    source: { capture: async () => { attempts++; throw precondition('original source unavailable', { code: 'native_postgres_source_unavailable' }); }, verify: f.source.verify } });
  await expect(physics.captureCurrent!(plan)).rejects.toThrow('original source unavailable');
  expect(attempts).toBe(1); expect(await f.catalog()).toEqual(before);
}));

test.skipIf(!available)('当前原生基线：持续采样冲突在一分钟总预算后终止，原名字锁释放', () => nativeOwnerFixture(async (f) => {
  const plan = await originalPlan(f), before = await f.catalog(); let attempts = 0;
  const physics = postgresNativeDeletionPhysics({ adminUrl: nativeOwnerUrl, reader: f.module.api.databaseReclamation!, assertGrant: async () => undefined,
    source: { capture: async () => { attempts++; throw busy(); }, verify: f.source.verify } });
  const started = performance.now();
  await expect(physics.captureCurrent!(plan)).rejects.toThrow('probe is sampling');
  expect(performance.now() - started).toBeGreaterThanOrEqual(59_000); expect(attempts).toBeGreaterThan(1);
  expect(await f.catalog()).toEqual(before);
  await expect(withNativePostgresNames(nativeOwnerUrl, [f.name, f.role], async () => true, { tryOnly: true })).resolves.toBe(true);
}), 75_000);
