import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import postgres from 'postgres';
import { ProjectDeletionContextSchema } from '@crewstation/contracts';
import type { ProjectDeletionContext } from '@crewstation/contracts';
import { fixedClock, jsonHash, precondition } from '@crewstation/kernel';
import { DEFAULT_TEST_DATABASE_URL, testDatabaseAvailable } from '@crewstation/testkit';
import { postgresDatabaseReclamation } from '../adapters/postgres/databaseReclamation';
import { postgresDatabaseRemoval } from '../adapters/postgres/databaseRemoval';
import { withNativePostgresNames } from '../adapters/postgres/nativeNames';
import type { OriginalPostgresDatabase } from '../api/databaseReclamation';

const available = await testDatabaseAvailable(), adminUrl = process.env.CS_TEST_DATABASE_URL ?? DEFAULT_TEST_DATABASE_URL;
const clock = fixedClock('2026-10-01T06:00:00.000Z');
const name = () => 'cs_rfc037_removal_' + Bun.randomUUIDv7().replaceAll('-', '').slice(-16);
const quoted = (value: string) => '"' + value + '"';
const literal = (value: string) => "'" + value.replaceAll("'", "''") + "'";
const shellLiteral = (value: string) => "'" + value.replaceAll("'", "'\\''") + "'";
function context(original: OriginalPostgresDatabase): ProjectDeletionContext {
  return ProjectDeletionContextSchema.parse({
    operationId: Bun.randomUUIDv7(), generation: 1, phase: 'purge',
    target: { id: Bun.randomUUIDv7(), slug: 'native-removal', name: '原生删除夹具', namespace: 'cs-native-removal', state: 'active', kind: 'DigitalWorker', revision: '1', prodHost: 'native.apps.test', previewHost: 'preview.native.apps.test', serviceHost: 'native.services.test' },
    confirmed: { participant: 'data-control', revision: jsonHash(original), complete: true, references: [], blockers: [],
      resources: [{ kind: 'postgres-database', id: original.name, identity: original.identity, sourceIdentity: original.identity, scope: 'physical', count: 1 }] },
  });
}

describe.skipIf(!available)('RFC-037 PostgreSQL：原 OID、原生锁和正常 DROP', () => {
  let admin: ReturnType<typeof postgres>, reader: ReturnType<typeof postgresDatabaseReclamation>, keeper: OriginalPostgresDatabase;
  const owned = new Set<string>();
  beforeAll(async () => {
    admin = postgres(adminUrl, { max: 1, onnotice: () => undefined }); reader = postgresDatabaseReclamation(adminUrl, clock);
    const kept = name(); owned.add(kept); await admin.unsafe('CREATE DATABASE ' + quoted(kept));
    keeper = await capture(kept);
  });
  afterAll(async () => {
    // Only unique fixture names or the fixture's observed original OID/quarantine are reclaimed here.
    for (const database of owned) await admin.unsafe('DROP DATABASE IF EXISTS ' + quoted(database) + ' WITH (FORCE)');
    await reader.close(); await admin.end();
  });
  async function capture(database: string) {
    const [row] = await admin.unsafe<{ oid: string }[]>('SELECT oid::text FROM pg_database WHERE datname=$1', [database]);
    return reader.capture({ name: database, oid: row!.oid });
  }
  async function rows(oid: string) {
    return admin.unsafe<{ name: string; oid: string; connects: boolean; comment: string | null }[]>('SELECT datname AS name,oid::text AS oid,datallowconn AS connects,shobj_description(oid,\'pg_database\') AS comment FROM pg_database WHERE oid=$1::oid', [oid]);
  }
  async function withDatabase(run: (original: OriginalPostgresDatabase, permit: ProjectDeletionContext) => Promise<void>) {
    const database = name(); owned.add(database); await admin.unsafe('CREATE DATABASE ' + quoted(database));
    const original = await capture(database);
    try { await run(original, context(original)); }
    finally {
      for (const row of await rows(original.oid)) { owned.add(row.name); await admin.unsafe('DROP DATABASE IF EXISTS ' + quoted(row.name) + ' WITH (FORCE)'); owned.delete(row.name); }
      await admin.unsafe('DROP DATABASE IF EXISTS ' + quoted(database) + ' WITH (FORCE)'); owned.delete(database);
      expect(await reader.verify(keeper)).toMatchObject({ kind: 'present', catalogPresent: true, remainingDirectories: 1 });
    }
  }
  const valid = async () => {};
  async function waitForNativeWait(database: string) {
    const until = Date.now() + 3000, key = 'crewstation.data-native-name:' + database;
    while (Date.now() < until) {
      const [row] = await admin.unsafe<{ found: boolean }[]>('SELECT EXISTS(SELECT 1 FROM pg_locks WHERE locktype=\'advisory\' AND NOT granted AND objsubid=1 AND classid::bigint=((hashtextextended($1,0)>>32)&4294967295) AND objid::bigint=(hashtextextended($1,0)&4294967295)) AS found', [key]);
      if (row?.found) return true; await Bun.sleep(10);
    }
    return false;
  }
  async function isolated(original: OriginalPostgresDatabase, permit: ProjectDeletionContext) {
    let calls = 0;
    const removal = postgresDatabaseRemoval(adminUrl, reader, async () => { if (++calls === 4) throw precondition('fixture grant expired before DROP'); });
    await expect(removal.remove(permit, original)).rejects.toThrow('fixture grant expired');
    const [row] = await rows(original.oid); owned.add(row!.name);
    expect(row?.name).not.toBe(original.name); expect(row?.connects).toBe(false);
    expect(JSON.parse(row!.comment!)).toMatchObject({ projectId: permit.target.id, operationId: permit.operationId, identity: original.identity });
    return row!;
  }

  test('正常 DROP 后原 catalog 与 base 目录实际归零；同操作重试不生成或删除其他库', () => withDatabase(async (original, permit) => {
    const removal = postgresDatabaseRemoval(adminUrl, reader, valid), result = await removal.remove(permit, original);
    expect(result).toMatchObject({ kind: 'gone', proof: { kind: 'gone', identity: original.identity } });
    expect(await rows(original.oid)).toHaveLength(0); expect(await reader.verify(original)).toMatchObject({ kind: 'gone' });
    expect(await removal.remove(permit, original)).toEqual(result);
  }));

  test('实际使用者仍连接时保留原库和准入；退出后正常删除', () => withDatabase(async (original, permit) => {
    const url = new URL(adminUrl); url.pathname = '/' + original.name;
    const user = postgres(url.toString(), { max: 1, onnotice: () => undefined });
    const removal = postgresDatabaseRemoval(adminUrl, reader, valid);
    try {
      await user.unsafe('SELECT 1');
      expect(await removal.remove(permit, original)).toEqual({ kind: 'waiting', reason: 'native-consumers' });
      expect((await rows(original.oid))[0]).toMatchObject({ name: original.name, connects: true, comment: null });
      expect(await user.unsafe('SELECT current_database() AS name')).toMatchObject([{ name: original.name }]);
    } finally { await user.end(); }
    expect(await removal.remove(permit, original)).toMatchObject({ kind: 'gone' });
  }));

  test('同名换 OID、损坏摘要及原服务器摘要变化均阻断；新库保持', () => withDatabase(async (original, permit) => {
    const removal = postgresDatabaseRemoval(adminUrl, reader, valid);
    await admin.unsafe('DROP DATABASE ' + quoted(original.name)); await admin.unsafe('CREATE DATABASE ' + quoted(original.name));
    const replacement = await capture(original.name);
    expect(replacement.oid).not.toBe(original.oid);
    await expect(removal.remove(permit, original)).rejects.toThrow('已替换');
    expect(await reader.verify(replacement)).toMatchObject({ kind: 'present' });
    const broken = { ...replacement, identity: jsonHash('broken') };
    await expect(removal.remove(context(broken), broken)).rejects.toThrow('摘要');
    const { identity: _identity, ...different } = { ...replacement, source: jsonHash('another-server') };
    const changed = { ...different, identity: jsonHash(different) };
    await expect(removal.remove(context(changed), changed)).rejects.toThrow('服务器来源变化');
    expect(await reader.verify(replacement)).toMatchObject({ kind: 'present' });
  }));

  test('隔离提交后许可失效保留原 OID 与本操作标记；新世代按同操作恢复', () => withDatabase(async (original, permit) => {
    const row = await isolated(original, permit);
    expect(await admin.unsafe('SELECT 1 FROM pg_database WHERE datname=$1', [original.name])).toHaveLength(0);
    const newer = { ...permit, generation: 2 };
    const removal = postgresDatabaseRemoval(adminUrl, reader, async (received) => {
      expect(received.operationId).toBe(permit.operationId); expect(received.generation).toBe(2);
    });
    expect(await removal.remove(newer, original)).toMatchObject({ kind: 'gone' });
    expect(await admin.unsafe('SELECT 1 FROM pg_database WHERE datname=$1', [row.name])).toHaveLength(0);
  }));

  test('隔离名字冲突、被改写的原操作和隔离后的同名重建均不接管', () => withDatabase(async (original, permit) => {
    const row = await isolated(original, permit), removal = postgresDatabaseRemoval(adminUrl, reader, valid);
    await admin.unsafe('COMMENT ON DATABASE ' + quoted(row.name) + " IS 'different-operation'");
    await expect(removal.remove(permit, original)).rejects.toThrow('标记');
    expect((await rows(original.oid))[0]?.name).toBe(row.name);
    await admin.unsafe('COMMENT ON DATABASE ' + quoted(row.name) + ' IS ' + literal(row.comment!));
    await admin.unsafe('ALTER DATABASE ' + quoted(row.name) + ' WITH ALLOW_CONNECTIONS true');
    await admin.unsafe('ALTER DATABASE ' + quoted(row.name) + ' RENAME TO ' + quoted(original.name));
    await admin.unsafe('CREATE DATABASE ' + quoted(row.name)); const conflict = await capture(row.name);
    await expect(removal.remove(permit, original)).rejects.toThrow('已替换');
    expect((await rows(original.oid))[0]?.name).toBe(original.name); expect(await reader.verify(conflict)).toMatchObject({ kind: 'present' });
    await admin.unsafe('DROP DATABASE ' + quoted(row.name)); owned.delete(row.name);
    const next = await isolated(original, permit); await admin.unsafe('CREATE DATABASE ' + quoted(original.name)); const replacement = await capture(original.name);
    await expect(removal.remove(permit, original)).rejects.toThrow('已替换');
    expect((await rows(original.oid))[0]?.name).toBe(next.name); expect(await reader.verify(replacement)).toMatchObject({ kind: 'present' });
  }));

  test('实际原生名字锁排空后才重查许可；其他原库可以清理，旧等待者不迟到执行', () => withDatabase(async (original, permit) => {
    const entered = Promise.withResolvers<void>(), hold = Promise.withResolvers<void>(); let allowed = true;
    const alternate = new URL(adminUrl); alternate.pathname = '/' + keeper.name;
    const source = withNativePostgresNames(alternate.toString(), [original.name], async (native) => {
      expect((await native.query<{ name: string }[]>('SELECT current_database() AS name'))[0]?.name).toBe('postgres');
      entered.resolve(); await hold.promise;
    });
    await entered.promise;
    const removal = postgresDatabaseRemoval(adminUrl, reader, async () => { if (!allowed) throw precondition('fixture closed'); });
    const running = removal.remove(permit, original).then(() => 'unexpected', (error: unknown) => String(error));
    try {
      expect(await waitForNativeWait(original.name)).toBe(true);
      await withDatabase(async (other, otherPermit) => { expect(await postgresDatabaseRemoval(adminUrl, reader, valid).remove(otherPermit, other)).toMatchObject({ kind: 'gone' }); });
      allowed = false;
    } finally { hold.resolve(); await source; }
    expect(await running).toContain('fixture closed');
    expect((await rows(original.oid))[0]).toMatchObject({ name: original.name, connects: true });
  }), 15_000);

  test('catalog 事务内许可失效时原名、准入和注释完整回滚', () => withDatabase(async (original, permit) => {
    const comment = 'fixture original comment';
    await admin.unsafe('COMMENT ON DATABASE ' + quoted(original.name) + ' IS ' + literal(comment));
    let calls = 0;
    const removal = postgresDatabaseRemoval(adminUrl, reader, async () => { if (++calls === 3) throw precondition('fixture transaction grant expired'); });
    await expect(removal.remove(permit, original)).rejects.toThrow('fixture transaction grant expired');
    expect((await rows(original.oid))[0]).toMatchObject({ name: original.name, connects: true, comment });
  }));

  test('实际 DROP 完成后许可失效不发完成回执；同操作可依据原文件归零恢复', () => withDatabase(async (original, permit) => {
    let calls = 0;
    const removal = postgresDatabaseRemoval(adminUrl, reader, async () => { if (++calls === 5) throw precondition('fixture receipt grant expired'); });
    await expect(removal.remove(permit, original)).rejects.toThrow('fixture receipt grant expired');
    expect(await rows(original.oid)).toHaveLength(0); expect(await reader.verify(original)).toMatchObject({ kind: 'gone' });
    expect(await postgresDatabaseRemoval(adminUrl, reader, valid).remove({ ...permit, generation: 2 }, original)).toMatchObject({ kind: 'gone' });
  }));

  test('真实原生 backend 在隔离后退出，不能换连接执行 DROP；同操作新连接可恢复', () => withDatabase(async (original, permit) => {
    let calls = 0;
    const removal = postgresDatabaseRemoval(adminUrl, reader, async () => {
      if (++calls !== 4) return;
      const key = 'crewstation.data-native-name:' + original.name;
      const [row] = await admin.unsafe<{ pid: number }[]>('SELECT pid FROM pg_locks WHERE locktype=\'advisory\' AND granted AND mode=\'ExclusiveLock\' AND objsubid=1 AND classid::bigint=((hashtextextended($1,0)>>32)&4294967295) AND objid::bigint=(hashtextextended($1,0)&4294967295)', [key]);
      expect(row?.pid).toBeGreaterThan(0); expect((await admin.unsafe('SELECT pg_terminate_backend($1) AS stopped', [row!.pid]))[0]?.stopped).toBe(true);
    });
    await expect(removal.remove(permit, original)).rejects.toThrow();
    const [row] = await rows(original.oid); owned.add(row!.name);
    expect(row).toMatchObject({ oid: original.oid, connects: false }); expect(row?.name).not.toBe(original.name);
    expect(await postgresDatabaseRemoval(adminUrl, reader, valid).remove(permit, original)).toMatchObject({ kind: 'gone' });
  }), 15_000);

  test('错误阶段、owner、未确认原身份、外部引用和封闭许可均在任何 DDL 前拒绝', () => withDatabase(async (original, permit) => {
    const removal = postgresDatabaseRemoval(adminUrl, reader, async () => { throw precondition('fixture invalid grant'); });
    await expect(removal.remove(permit, original)).rejects.toThrow('fixture invalid grant');
    for (const changed of [{ ...permit, phase: 'metadata' }, { ...permit, confirmed: { ...permit.confirmed, participant: 'data' } },
      { ...permit, confirmed: { ...permit.confirmed, resources: [] } }, { ...permit, confirmed: { ...permit.confirmed, complete: false } },
      { ...permit, confirmed: { ...permit.confirmed, references: [{ kind: 'outside', id: 'other', description: 'still referenced' }] } }]) {
      await expect(postgresDatabaseRemoval(adminUrl, reader, valid).remove(changed as ProjectDeletionContext, original)).rejects.toThrow('许可');
    }
    expect((await rows(original.oid))[0]).toMatchObject({ name: original.name, connects: true, comment: null });
  }));

  test('DROP 后 catalog 已无而原 OID 普通文件仍在，等待真实归零，不删孤儿路径', () => withDatabase(async (original, permit) => {
    await admin.unsafe('DROP DATABASE ' + quoted(original.name));
    const [root] = await admin.unsafe<{ directory: string }[]>("SELECT current_setting('data_directory') AS directory");
    const residual = root!.directory + '/base/' + original.oid;
    await admin.unsafe("COPY (SELECT 'fixture-owned native residual') TO " + literal(residual));
    try {
      expect(await postgresDatabaseRemoval(adminUrl, reader, valid).remove(permit, original)).toEqual({ kind: 'waiting', reason: 'original-files' });
      expect((await admin.unsafe('SELECT (pg_stat_file($1,true)).isdir AS directory', [residual]))[0]?.directory).toBe(false);
    } finally {
      await admin.unsafe('CREATE TEMP TABLE rfc037_removal_cleanup (line text)');
      await admin.unsafe('COPY pg_temp.rfc037_removal_cleanup FROM PROGRAM ' + literal('rm -- ' + shellLiteral(residual)));
      await admin.unsafe('DROP TABLE pg_temp.rfc037_removal_cleanup');
    }
    expect(await postgresDatabaseRemoval(adminUrl, reader, valid).remove(permit, original)).toMatchObject({ kind: 'gone' });
  }));
});
