import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import postgres from 'postgres';
import { ProjectDeletionContextSchema } from '@crewstation/contracts';
import type { ProjectDeletionContext } from '@crewstation/contracts';
import { jsonHash } from '@crewstation/kernel';
import { DEFAULT_TEST_DATABASE_URL, resolveCapability, testDatabaseAvailable } from '@crewstation/testkit';
import { postgresRoleRemoval } from '../adapters/postgres/roleRemoval';
import { withNativePostgresNames } from '../adapters/postgres/nativeNames';
import type { OriginalPostgresRole } from '../api/databaseRemoval';

const available = await testDatabaseAvailable(), adminUrl = process.env.CS_TEST_DATABASE_URL ?? DEFAULT_TEST_DATABASE_URL;
const preparedAvailable = await (async () => {
  if (!available) return false;
  const connection = postgres(adminUrl, { max: 1 });
  try {
    const supported = Number((await connection.unsafe<{ max_prepared_transactions: string }[]>('SHOW max_prepared_transactions'))[0]?.max_prepared_transactions) > 0;
    return resolveCapability('database', supported, '角色回收的预备事务用例需要测试 PostgreSQL 的 max_prepared_transactions > 0');
  }
  finally { await connection.end(); }
})();
const name = () => 'cs_role_removal_' + Bun.randomUUIDv7().replaceAll('-', '').slice(-16);
function context(peers: readonly OriginalPostgresRole[]): ProjectDeletionContext {
  return ProjectDeletionContextSchema.parse({
    operationId: Bun.randomUUIDv7(), generation: 1, phase: 'purge',
    target: { id: Bun.randomUUIDv7(), slug: 'role-removal', name: '原角色夹具', namespace: 'cs-role-removal', state: 'active', kind: 'DigitalWorker', revision: '1', prodHost: 'role.apps.test', previewHost: 'preview.role.apps.test', serviceHost: 'role.services.test' },
    confirmed: { participant: 'data-control', revision: jsonHash(peers), complete: true, references: [], blockers: [], resources: peers.map((r) => ({ kind: 'postgres-role', id: r.name, identity: r.identity, sourceIdentity: r.identity, scope: 'physical', count: 1 })) },
  });
}
describe.skipIf(!available)('RFC-037 PostgreSQL：原角色 OID、全部数据库依赖与正常 DROP', () => {
  let admin: ReturnType<typeof postgres>, keeper: OriginalPostgresRole;
  const roles = new Set<string>(), databases = new Set<string>();
  const remover = postgresRoleRemoval(adminUrl, async () => undefined);
  const current = (role: string) => admin.unsafe<{ oid: string }[]>('SELECT oid::text FROM pg_roles WHERE rolname=$1', [role]);
  const capture = async (role: string) => remover.capture({ name: role, oid: (await current(role))[0]!.oid });
  beforeAll(async () => { admin = postgres(adminUrl, { max: 1, onnotice: () => undefined }); const role = name(); roles.add(role); await admin.unsafe('CREATE ROLE "' + role + '" NOLOGIN'); keeper = await capture(role); });
  afterAll(async () => {
    for (const database of databases) await admin.unsafe('DROP DATABASE IF EXISTS "' + database + '" WITH (FORCE)');
    for (const role of roles) await admin.unsafe('DROP ROLE IF EXISTS "' + role + '"');
    await admin.end();
  });
  async function fixture(run: (role: OriginalPostgresRole, permit: ProjectDeletionContext) => Promise<void>) {
    const role = name(); roles.add(role); await admin.unsafe('CREATE ROLE "' + role + '" LOGIN PASSWORD \'RoleFixture_1234567890\'');
    const original = await capture(role);
    try { await run(original, context([original])); }
    finally { await admin.unsafe('DROP ROLE IF EXISTS "' + role + '"'); roles.delete(role); expect((await current(keeper.name))[0]?.oid).toBe(keeper.oid); }
  }
  test('原角色正常 DROP、重试仍按原来源证明归零，预定义只读成员关系不会连带删除其他角色', () => fixture(async (role, permit) => {
    await admin.unsafe('GRANT pg_read_all_data TO "' + role.name + '"');
    expect(await remover.remove(permit, role, [role])).toMatchObject({ kind: 'gone', identity: role.identity });
    expect(await current(role.name)).toHaveLength(0);
    expect(await current('pg_read_all_data')).toHaveLength(1);
    expect(await remover.remove(permit, role, [role])).toMatchObject({ kind: 'gone', identity: role.identity });
  }));
  test('实际活动连接阻断，不取消消费者；原连接退出后才删除', () => fixture(async (role, permit) => {
    const url = new URL(adminUrl); url.pathname = '/postgres'; url.username = role.name; url.password = 'RoleFixture_1234567890';
    const user = postgres(url.toString(), { max: 1, onnotice: () => undefined });
    try {
      await user.unsafe('SELECT 1');
      expect(await remover.remove(permit, role, [role])).toEqual({ kind: 'waiting', reason: 'native-consumers' });
      expect((await user.unsafe<{ one: number }[]>('SELECT 1 AS one'))[0]?.one).toBe(1);
      expect((await current(role.name))[0]?.oid).toBe(role.oid);
    } finally { await user.end(); }
    const deadline = Date.now() + 2000;
    while ((await admin.unsafe('SELECT 1 FROM pg_stat_activity WHERE usesysid=$1::oid', [role.oid])).length) { if (Date.now() > deadline) throw new Error('original role consumer remains'); await Bun.sleep(10); }
    expect(await remover.remove(permit, role, [role])).toMatchObject({ kind: 'gone' });
  }));
  test.skipIf(!preparedAvailable)('原连接已退出而预备事务仍在时等待，事务完成后才回收原角色', () => fixture(async (role, permit) => {
    const url = new URL(adminUrl); url.pathname = '/postgres';
    const coordinator = postgres(url.toString(), { max: 1, onnotice: () => undefined });
    url.username = role.name; url.password = 'RoleFixture_1234567890';
    const user = postgres(url.toString(), { max: 1, onnotice: () => undefined }), gid = name();
    let prepared = false;
    try {
      await user.unsafe('BEGIN'); await user.unsafe('SELECT 1'); await user.unsafe("PREPARE TRANSACTION '" + gid + "'"); prepared = true;
      await user.end();
      expect(await remover.remove(permit, role, [role])).toEqual({ kind: 'waiting', reason: 'native-consumers' });
      expect((await current(role.name))[0]?.oid).toBe(role.oid);
      expect((await coordinator.unsafe<{ owner: string }[]>('SELECT owner FROM pg_prepared_xacts WHERE gid=$1', [gid]))[0]?.owner).toBe(role.name);
      await coordinator.unsafe("ROLLBACK PREPARED '" + gid + "'"); prepared = false;
      expect(await remover.remove(permit, role, [role])).toMatchObject({ kind: 'gone', identity: role.identity });
    } finally {
      await user.end();
      if (prepared) await coordinator.unsafe("ROLLBACK PREPARED '" + gid + "'");
      await coordinator.end();
    }
  }));
  test('同名新 OID、原服务器变化和错误摘要均拒绝，不能接管替换角色', () => fixture(async (role, permit) => {
    const changed = { name: role.name, oid: role.oid, source: 'b'.repeat(64) }, changedRole = { ...changed, identity: jsonHash(changed) };
    await expect(remover.remove(context([changedRole]), changedRole, [changedRole])).rejects.toThrow('服务器来源变化');
    expect((await current(role.name))[0]?.oid).toBe(role.oid);
    await admin.unsafe('DROP ROLE "' + role.name + '"'); await admin.unsafe('CREATE ROLE "' + role.name + '" NOLOGIN');
    const replacement = (await current(role.name))[0]!.oid;
    expect(replacement).not.toBe(role.oid);
    await expect(remover.remove(permit, role, [role])).rejects.toThrow('替换');
    expect((await current(role.name))[0]?.oid).toBe(replacement);
    await expect(remover.remove(permit, { ...role, identity: 'a'.repeat(64) }, [role])).rejects.toThrow('摘要');
  }));
  test('原角色在另一个数据库拥有对象时保留全部内容；不执行全局 DROP OWNED 或转移外部所有权', () => fixture(async (role, permit) => {
    const database = name(); databases.add(database); await admin.unsafe('CREATE DATABASE "' + database + '"');
    const url = new URL(adminUrl); url.pathname = '/' + database;
    const foreign = postgres(url.toString(), { max: 1, onnotice: () => undefined });
    try {
      await foreign.unsafe('CREATE TABLE foreign_material(value text)'); await foreign.unsafe("INSERT INTO foreign_material VALUES ('preserve')");
      await foreign.unsafe('ALTER TABLE foreign_material OWNER TO "' + role.name + '"');
      expect(await remover.remove(permit, role, [role])).toEqual({ kind: 'waiting', reason: 'native-dependencies' });
      expect((await foreign.unsafe<{ tableowner: string }[]>("SELECT tableowner FROM pg_tables WHERE tablename='foreign_material'"))[0]?.tableowner).toBe(role.name);
      expect((await foreign.unsafe<{ value: string }[]>('SELECT value FROM foreign_material'))[0]?.value).toBe('preserve');
    } finally { await foreign.end(); await admin.unsafe('DROP DATABASE "' + database + '"'); databases.delete(database); }
    expect(await remover.remove(permit, role, [role])).toMatchObject({ kind: 'gone' });
  }));
  test('其他角色仍继承原角色时等待；只有同一确认范围内的角色成员关系可以被正常 DROP 自动撤销', () => fixture(async (role, permit) => {
    const peerName = name(); roles.add(peerName); await admin.unsafe('CREATE ROLE "' + peerName + '" NOLOGIN');
    try {
      await admin.unsafe('GRANT "' + role.name + '" TO "' + peerName + '"');
      expect(await remover.remove(permit, role, [role])).toEqual({ kind: 'waiting', reason: 'native-dependencies' });
      const peer = await capture(peerName), both = [role, peer];
      expect(await remover.remove(context(both), role, both)).toMatchObject({ kind: 'gone' });
      expect((await current(peerName))[0]?.oid).toBe(peer.oid);
    } finally { await admin.unsafe('DROP ROLE "' + peerName + '"'); roles.delete(peerName); }
  }));
  test('事务内许可失效完整回滚原角色；实际提交后回执丢失由同操作依据原来源恢复', () => fixture(async (role, permit) => {
    let grants = 0;
    const beforeCommit = postgresRoleRemoval(adminUrl, async () => { if (++grants === 4) throw new Error('fixture grant lost before commit'); });
    await expect(beforeCommit.remove(permit, role, [role])).rejects.toThrow('before commit');
    expect((await current(role.name))[0]?.oid).toBe(role.oid);
    grants = 0;
    const afterCommit = postgresRoleRemoval(adminUrl, async () => { if (++grants === 5) throw new Error('fixture receipt lost after commit'); });
    await expect(afterCommit.remove(permit, role, [role])).rejects.toThrow('after commit');
    expect(await current(role.name)).toHaveLength(0);
    expect(await remover.remove({ ...permit, generation: 2 }, role, [role])).toMatchObject({ kind: 'gone', identity: role.identity });
  }));
  test('原生名字锁等待后再次核对许可，不使用排队前许可删除', () => fixture(async (role, permit) => {
    const entered = Promise.withResolvers<void>(), release = Promise.withResolvers<void>();
    const holder = withNativePostgresNames(adminUrl, [role.name], async () => { entered.resolve(); await release.promise; }); await entered.promise;
    let grants = 0, open = true;
    const guarded = postgresRoleRemoval(adminUrl, async () => { grants += 1; if (!open) throw new Error('fixture original grant closed'); });
    const removal = guarded.remove(permit, role, [role]).then(() => 'unexpected', (error: Error) => error.message);
    try { await Bun.sleep(30); expect(grants).toBe(1); open = false; } finally { release.resolve(); await holder; }
    expect(await removal).toContain('original grant closed'); expect((await current(role.name))[0]?.oid).toBe(role.oid);
  }));
  test('错误阶段、范围不完整、外部引用和初次 absent 都不构成角色删除许可', () => fixture(async (role, permit) => {
    await expect(remover.remove({ ...permit, phase: 'metadata' }, role, [role])).rejects.toThrow('许可');
    await expect(remover.remove(permit, role, [])).rejects.toThrow('许可');
    await expect(remover.remove({ ...permit, confirmed: { ...permit.confirmed, references: [{ kind: 'foreign-role', id: 'other', description: '保留' }] } }, role, [role])).rejects.toThrow('许可');
    await expect(remover.capture({ name: 'postgres', oid: role.oid })).rejects.toThrow('不合法');
    await expect(remover.capture({ name: name(), oid: role.oid })).rejects.toThrow('替换');
    const missing = name(); await expect(remover.capture({ name: missing, oid: '4294967295' })).rejects.toThrow('初次');
    expect((await current(role.name))[0]?.oid).toBe(role.oid);
  }));
});
