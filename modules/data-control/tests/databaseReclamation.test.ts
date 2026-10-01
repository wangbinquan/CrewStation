import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import postgres from 'postgres';
import { fixedClock, jsonHash } from '@crewstation/kernel';
import { DEFAULT_TEST_DATABASE_URL, testDatabaseAvailable } from '@crewstation/testkit';
import { postgresDatabaseReclamation } from '../adapters/postgres/databaseReclamation';
import type { OriginalPostgresDatabase } from '../api/databaseReclamation';
import { createDataControlModule } from '../wiring';

const available = await testDatabaseAvailable(), adminUrl = process.env.CS_TEST_DATABASE_URL ?? DEFAULT_TEST_DATABASE_URL;
const clock = fixedClock('2026-10-01T00:00:00.000Z');
const literal = (value: string) => `'${value.replaceAll("'", "''")}'`;
const name = () => `cs_rfc037_physics_${Bun.randomUUIDv7().replaceAll('-', '').slice(-16)}`;
const rehash = (original: OriginalPostgresDatabase, overrides: Partial<OriginalPostgresDatabase>) => {
  const { identity: _identity, ...target } = { ...original, ...overrides };
  return { ...target, identity: jsonHash(target) };
};

describe.skipIf(!available)('RFC-037 PostgreSQL：原 OID 的真实 catalog 与文件来源', () => {
  let admin: ReturnType<typeof postgres>, reader: ReturnType<typeof postgresDatabaseReclamation>, keeper: { name: string; oid: string };
  const databases = new Set<string>();
  beforeAll(async () => {
    admin = postgres(adminUrl, { max: 1, onnotice: () => undefined });
    reader = postgresDatabaseReclamation(adminUrl, clock);
    const keptName = name(); databases.add(keptName);
    await admin.unsafe(`CREATE DATABASE "${keptName}"`);
    keeper = { name: keptName, oid: (await admin<{ oid: string }[]>`SELECT oid::text FROM pg_database WHERE datname=${keptName}`)[0]!.oid };
  });
  afterAll(async () => {
    for (const database of databases) await admin.unsafe(`DROP DATABASE IF EXISTS "${database}" WITH (FORCE)`);
    await reader.close(); await admin.end();
  });
  async function withDatabase<T>(run: (target: { name: string; oid: string }) => Promise<T>, space?: string): Promise<T> {
    const database = name(); databases.add(database);
    await admin.unsafe(`CREATE DATABASE "${database}"${space ? ` TABLESPACE "${space}"` : ''}`);
    const oid = (await admin<{ oid: string }[]>`SELECT oid::text FROM pg_database WHERE datname=${database}`)[0]!.oid;
    try { return await run({ name: database, oid }); }
    finally { await admin.unsafe(`DROP DATABASE IF EXISTS "${database}" WITH (FORCE)`); databases.delete(database); }
  }
  async function program(command: string) {
    await admin.unsafe('CREATE TEMP TABLE IF NOT EXISTS rfc037_physics_program_output (line text)');
    await admin.unsafe(`COPY pg_temp.rfc037_physics_program_output FROM PROGRAM ${literal(command)}`);
  }
  async function withSpace<T>(run: (space: { name: string; root: string; oid: string }) => Promise<T>): Promise<T> {
    const id = Bun.randomUUIDv7().replaceAll('-', ''), space = `cs_rfc037_space_${id.slice(-16)}`, root = `/tmp/cs_rfc037_space_${id}`;
    // Own unique empty directory only; native DROP TABLESPACE must finish before rmdir.
    await program(`mkdir ${root}`);
    let created = false;
    try {
      await admin.unsafe(`CREATE TABLESPACE "${space}" LOCATION ${literal(root)}`); created = true;
      const oid = (await admin<{ oid: string }[]>`SELECT oid::text FROM pg_tablespace WHERE spcname=${space}`)[0]!.oid;
      return await run({ name: space, root, oid });
    } finally {
      if (created) await admin.unsafe(`DROP TABLESPACE IF EXISTS "${space}"`);
      await program(`rmdir ${root}`);
    }
  }
  async function assertKeeper() {
    expect((await admin<{ oid: string }[]>`SELECT oid::text FROM pg_database WHERE datname=${keeper.name}`)[0]?.oid).toBe(keeper.oid);
    expect(await reader.verify(await reader.capture(keeper))).toMatchObject({ kind: 'present', catalogPresent: true, remainingDirectories: 1 });
  }

  test('base 原目录与 OID 实际在；DROP 后 catalog 与文件都归零，其他库原 OID 和目录保持', () => withDatabase(async (target) => {
    const original = await reader.capture(target);
    expect(original.directories).toContainEqual({ tablespaceOid: null, root: 'base' });
    expect(original.source).toMatch(/^[a-f0-9]{64}$/);
    expect(JSON.stringify(original)).not.toContain(new URL(adminUrl).password);
    expect(await reader.verify(original)).toEqual({ kind: 'present', catalogPresent: true, remainingDirectories: 1, observedAt: clock.now().toISOString() });
    await admin.unsafe(`DROP DATABASE "${target.name}"`);
    const gone = await reader.verify(original);
    expect(gone).toMatchObject({ kind: 'gone', identity: original.identity, observedAt: clock.now().toISOString() });
    if (gone.kind !== 'gone') throw new Error('missing physical proof');
    expect(gone.digest).toMatch(/^[a-f0-9]{64}$/);
    expect(await reader.verify(original)).toEqual(gone);
    await assertKeeper();
  }));

  test('初次 absent、错 OID、非平台名字和损坏摘要拒绝；源摘要变化不能给出 gone', () => withDatabase(async (target) => {
    await expect(reader.capture({ name: name(), oid: target.oid })).rejects.toThrow('无法匹配');
    await expect(reader.capture({ ...target, oid: '1' })).rejects.toThrow('无法匹配');
    for (const invalid of [{ ...target, name: 'postgres' }, { ...target, oid: '0' }, { ...target, oid: '4294967296' }, { ...target, oid: '1;DROP DATABASE' }]) await expect(reader.capture(invalid)).rejects.toThrow('不合法');
    const original = await reader.capture(target);
    await expect(reader.verify({ ...original, source: 'x' })).rejects.toThrow('摘要');
    await expect(reader.verify(rehash(original, { source: jsonHash('different-original-server') }))).rejects.toThrow('服务器来源变化');
    await expect(reader.verify(rehash(original, { directories: [] }))).rejects.toThrow('摘要');
    await expect(reader.verify(rehash(original, { directories: [{ tablespaceOid: null, root: 'elsewhere' }] }))).rejects.toThrow('摘要');
    await admin.unsafe(`DROP DATABASE "${target.name}"`);
    await expect(reader.capture(target)).rejects.toThrow('初次 absent');
  }));

  test('同名重建的原 OID 不同：明确 replaced，保留新库；原库改名同样阻断', () => withDatabase(async (target) => {
    const original = await reader.capture(target);
    await admin.unsafe(`DROP DATABASE "${target.name}"`);
    await admin.unsafe(`CREATE DATABASE "${target.name}"`);
    const replacement = (await admin<{ oid: string }[]>`SELECT oid::text FROM pg_database WHERE datname=${target.name}`)[0]!.oid;
    expect(replacement).not.toBe(target.oid);
    expect(await reader.verify(original)).toEqual({ kind: 'replaced', observedAt: clock.now().toISOString() });
    expect((await admin<{ oid: string }[]>`SELECT oid::text FROM pg_database WHERE datname=${target.name}`)[0]?.oid).toBe(replacement);
    const fresh = await reader.capture({ ...target, oid: replacement }), renamed = name(); databases.add(renamed);
    try {
      await admin.unsafe(`ALTER DATABASE "${target.name}" RENAME TO "${renamed}"`);
      expect(await reader.verify(fresh)).toMatchObject({ kind: 'replaced' });
      expect((await admin<{ oid: string }[]>`SELECT oid::text FROM pg_database WHERE datname=${renamed}`)[0]?.oid).toBe(replacement);
    } finally { await admin.unsafe(`DROP DATABASE IF EXISTS "${renamed}"`); databases.delete(renamed); }
    await assertKeeper();
  }));

  test('真实 tablespace 原目录一并核实，catalog 已删而原目录仍在时不报完成', () => withSpace((space) => withDatabase(async (target) => {
    const original = await reader.capture(target), directory = original.directories.find((entry) => entry.tablespaceOid === space.oid)!;
    expect(directory.root.startsWith(`${space.root}/PG_`)).toBe(true);
    expect(await reader.verify(original)).toMatchObject({ kind: 'present', remainingDirectories: 1 });
    await admin.unsafe(`DROP DATABASE "${target.name}"`);
    expect(await reader.verify(original)).toMatchObject({ kind: 'gone' });
    const residual = `${directory.root}/${target.oid}`;
    expect(residual).toMatch(/^\/tmp\/cs_rfc037_space_[a-f0-9]{32}\/PG_[0-9]+_[0-9]+\/[0-9]+$/);
    await program(`mkdir ${residual}`);
    try { expect(await reader.verify(original)).toMatchObject({ kind: 'present', catalogPresent: false, remainingDirectories: 1 }); }
    finally { await program(`rmdir ${residual}`); }
    expect(await reader.verify(original)).toMatchObject({ kind: 'gone' });
    await assertKeeper();
  }, space.name)));

  test('原 OID 路径变成普通文件仍是残留；未知 tablespace 根内容不能省略', () => withSpace((space) => withDatabase(async (target) => {
    const original = await reader.capture(target), directory = original.directories.find((entry) => entry.tablespaceOid === space.oid)!;
    await admin.unsafe(`DROP DATABASE "${target.name}"`);
    const residual = `${directory.root}/${target.oid}`, unknown = `${space.root}/unknown-rfc037-test-file`;
    await admin.unsafe(`COPY (SELECT 'rfc037-test-only') TO ${literal(residual)}`);
    try { expect(await reader.verify(original)).toMatchObject({ kind: 'present', catalogPresent: false, remainingDirectories: 1 }); }
    finally { await program(`rm -- ${residual}`); }
    await admin.unsafe(`COPY (SELECT 'rfc037-test-only') TO ${literal(unknown)}`);
    try { await expect(reader.verify(original)).rejects.toThrow('版本目录无法完整核实'); }
    finally { await program(`rm -- ${unknown}`); }
    expect(await reader.verify(original)).toMatchObject({ kind: 'gone' });
  }, space.name)));

  test('原 tablespace catalog 与版本目录消失不能替代原位置物理证明', () => withSpace((space) => withDatabase(async (target) => {
    const original = await reader.capture(target);
    await admin.unsafe(`DROP DATABASE "${target.name}"`);
    await admin.unsafe(`DROP TABLESPACE "${space.name}"`);
    await expect(reader.verify(original)).rejects.toThrow('原表空间位置或版本来源变化');
  }, space.name)));

  test('配置失效／连接不可达不当作 gone；正式模块的原生只读入口随 observer 正常关闭', async () => {
    const broken = new URL(adminUrl); broken.port = '1';
    const failure = postgresDatabaseReclamation(broken.toString(), clock);
    try { await expect(failure.capture(keeper)).rejects.toThrow(); } finally { await failure.close(); }
    const control = createDataControlModule({ adminUrl, clock, ledger: { get: async () => undefined, listLive: async () => [], changesSince: async () => [], latestChange: async () => 0, observe: async () => ({ status: 'unowned' }) } });
    try {
      expect(control.api.databaseReclamation).toBeDefined();
      expect(await control.api.databaseReclamation!.verify(await control.api.databaseReclamation!.capture(keeper))).toMatchObject({ kind: 'present' });
    } finally { await control.observer.stop(); }
    await expect(control.api.databaseReclamation!.capture(keeper)).rejects.toThrow();
  }, 30_000);
});
