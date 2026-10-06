import { expect, test } from 'bun:test';
import postgres from 'postgres';
import type { ProjectId } from '@crewstation/contracts';
import { DEFAULT_TEST_DATABASE_URL, createTestDatabase, testDatabaseAvailable } from '@crewstation/testkit';
import { jsonHash, precondition } from '@crewstation/kernel';
import { runMigrations } from '@crewstation/persistence';
import { sql } from 'drizzle-orm';
import { nativePostgresWork } from '../adapters/persistence/nativeWork';
import type { NativePostgresSource, NativePostgresStorageSource } from '../api/storageSource';
import { createDataControlModule, dataControlMigrations } from '../wiring';

const available = await testDatabaseAvailable(), adminUrl = process.env.CS_TEST_DATABASE_URL ?? DEFAULT_TEST_DATABASE_URL;
const storage: NativePostgresStorageSource = { identity: jsonHash('original-volume'), serviceUid: 'service-original', server: { podUid: 'server-original', containerId: 'containerd://server-original', nodeUid: 'node-original', address: '127.0.0.1' }, volumes: [{ pvcUid: 'pvc-original', pvUid: 'pv-original', nodeUid: 'node-original', mountPath: '/pg', providerPath: '/storage/pg-original', rootEpoch: jsonHash('root'), volumeEpoch: jsonHash('volume'), entries: [{ key: 'pgdata', relativePath: 'pgdata', kind: 'directory', identity: jsonHash('pgdata') }, { key: 'control', relativePath: 'pgdata/global/pg_control', kind: 'file', identity: jsonHash('control') }] }], observedAt: new Date().toISOString() };
type Catalog = Array<{ kind: 'database' | 'role'; name: string; oid: string }>;
type JournalRow = { work_id: string; state: string; catalog_before: Catalog | null; catalog_after: Catalog | null; storage_before: NativePostgresStorageSource | null; storage_after: NativePostgresStorageSource | null };
function errorCause<T>(query: PromiseLike<T>): Promise<T> { return Promise.resolve(query).catch((error: unknown) => { throw error instanceof Error ? error.cause ?? error : error; }); }
async function fixture(run: (f: Awaited<ReturnType<typeof setup>>) => Promise<void>, source?: NativePostgresSource) {
  const f = await setup(source);
  try { await run(f); }
  finally { await f.admin.unsafe('DROP DATABASE IF EXISTS "' + f.name + '"'); await f.admin.unsafe('DROP ROLE IF EXISTS "' + f.role + '"'); await f.admin.end(); await f.database.drop(); }
}
async function setup(source?: NativePostgresSource) {
  const database = await createTestDatabase([dataControlMigrations]), admin = postgres(adminUrl, { max: 1, onnotice: () => undefined });
  const origin = { projectId: Bun.randomUUIDv7() as ProjectId, resourceId: Bun.randomUUIDv7() }, name = 'cs_journal_' + Bun.randomUUIDv7().replaceAll('-', '').slice(-16), role = name + '_r';
  const work = nativePostgresWork({ db: database.db, adminUrl, source });
  const rows = () => database.db.execute<JournalRow>('SELECT * FROM data_control.deletion_work ORDER BY work_id');
  return { database, admin, origin, name, role, work, rows };
}
function observedSource(onCapture: (count: number) => NativePostgresStorageSource | Promise<NativePostgresStorageSource> = () => storage): NativePostgresSource {
  let captures = 0;
  return { capture: async (connection) => { await connection.assertHeld(); return onCapture(++captures); }, verify: async () => { throw new Error('journal must retain the actual post-capture, rather than discard it in verify'); } };
}

test.skipIf(!available)('原生身份：副作用前独立提交完整名字/OID/卷来源，正常 CREATE 后保存真实原库和角色', () => fixture(async (f) => {
  await f.work.native.run(f.origin, [f.name, f.role], async (connection) => {
    expect((await f.rows())[0]).toMatchObject({ state: 'running', catalog_before: [], catalog_after: null, storage_before: storage, storage_after: null });
    await connection.query('CREATE ROLE "' + f.role + '" NOLOGIN');
    await connection.query('CREATE DATABASE "' + f.name + '" OWNER "' + f.role + '"');
  });
  const databases = await f.admin.unsafe<{ oid: string }[]>('SELECT oid::text FROM pg_database WHERE datname=$1', [f.name]), roles = await f.admin.unsafe<{ oid: string }[]>('SELECT oid::text FROM pg_roles WHERE rolname=$1', [f.role]);
  expect((await f.rows())[0]).toMatchObject({ state: 'finished', catalog_after: [{ kind: 'database', name: f.name, oid: databases[0]!.oid }, { kind: 'role', name: f.role, oid: roles[0]!.oid }], storage_after: storage });
}, observedSource()));

test.skipIf(!available)('原生身份：DROP 后原 OID 仍保留，同名重建的新 OID不能替换旧回调历史', () => fixture(async (f) => {
  await f.work.native.run(f.origin, [f.role], (connection) => connection.query('CREATE ROLE "' + f.role + '" NOLOGIN'));
  const original = (await f.rows())[0]!.catalog_after;
  expect(original).toHaveLength(1);
  await f.work.native.run(f.origin, [f.role], (connection) => connection.query('DROP ROLE "' + f.role + '"'));
  expect((await f.rows())[1]).toMatchObject({ catalog_before: original, catalog_after: [] });
  await f.work.native.run(f.origin, [f.role], (connection) => connection.query('CREATE ROLE "' + f.role + '" NOLOGIN'));
  const rows = await f.rows();
  expect(rows[2]!.catalog_after![0]!.oid).not.toBe(original![0]!.oid);
  expect(rows[0]!.catalog_after).toEqual(original);
  await expect(errorCause(f.database.db.execute("UPDATE data_control.deletion_work SET catalog_after='[]'::jsonb"))).rejects.toThrow('immutable');
  await expect(errorCause(f.database.db.execute('DELETE FROM data_control.deletion_work'))).rejects.toThrow('journal');
}, observedSource()));

test.skipIf(!available)('原生身份：DDL 已提交后回调报错，仍保存提交后的真实 OID，不能只按异常认为没有资源', () => fixture(async (f) => {
  await expect(f.work.native.run(f.origin, [f.role], async (connection) => { await connection.query('CREATE ROLE "' + f.role + '" NOLOGIN'); throw new Error('after committed DDL'); })).rejects.toThrow('after committed DDL');
  const [actual] = await f.admin.unsafe<{ oid: string }[]>('SELECT oid::text FROM pg_roles WHERE rolname=$1', [f.role]);
  expect((await f.rows())[0]).toMatchObject({ state: 'finished', catalog_before: [], catalog_after: [{ kind: 'role', name: f.role, oid: actual!.oid }], storage_before: storage, storage_after: storage });
}, observedSource()));

test.skipIf(!available)('原生身份：副作用前独立来源不可用，零 DDL；有退出事实不冒充完整来源', () => fixture(async (f) => {
  let effects = 0;
  await expect(f.work.native.run(f.origin, [f.role], async () => { effects += 1; })).rejects.toThrow('source unavailable');
  expect(effects).toBe(0);
  expect((await f.rows())[0]).toMatchObject({ state: 'finished', catalog_before: null, catalog_after: null, storage_before: null, storage_after: null });
}, observedSource(() => { throw new Error('source unavailable'); })));

test.skipIf(!available)('原生身份：副作用后卷替换保留前后两份真实来源并拒绝成功，不能覆盖原卷', () => fixture(async (f) => {
  await expect(f.work.native.run(f.origin, [f.role], (connection) => connection.query('CREATE ROLE "' + f.role + '" NOLOGIN'))).rejects.toThrow('已替换');
  const row = (await f.rows())[0]!;
  expect(row).toMatchObject({ state: 'finished', catalog_before: [], storage_before: storage });
  expect(row.catalog_after).toHaveLength(1);
  expect(row.storage_after!.identity).toBe(jsonHash('replacement-volume'));
  expect(await f.admin.unsafe('SELECT 1 FROM pg_roles WHERE rolname=$1', [f.role])).toHaveLength(1);
}, observedSource((count) => count === 1 ? storage : { ...storage, identity: jsonHash('replacement-volume') })));

test.skipIf(!available)('原生身份：未配置独立来源保持缺失，不伪造已核实卷；SQL OID 历史仍完整保存', () => fixture(async (f) => {
  await f.work.native.run(f.origin, [f.role], (connection) => connection.query('CREATE ROLE "' + f.role + '" NOLOGIN'));
  expect((await f.rows())[0]).toMatchObject({ catalog_before: [], storage_before: null, storage_after: null });
  expect((await f.rows())[0]!.catalog_after).toHaveLength(1);
}));

test.skipIf(!available)('原生身份：副作用后来源暂不可用仍保留已提交 OID，缺失后置来源拒绝成功', () => fixture(async (f) => {
  await expect(f.work.native.run(f.origin, [f.role], (connection) => connection.query('CREATE ROLE "' + f.role + '" NOLOGIN'))).rejects.toThrow('post source unavailable');
  const row = (await f.rows())[0]!;
  expect(row).toMatchObject({ state: 'finished', catalog_before: [], storage_before: storage, storage_after: null });
  expect(row.catalog_after).toHaveLength(1);
}, observedSource((count) => { if (count > 1) throw new Error('post source unavailable'); return storage; })));

test.skipIf(!available)('原生身份：只对独立探针明确忙碌重试，同一原锁下取得来源前不执行 DDL', () => fixture(async (f) => {
  let effects = 0;
  await f.work.native.run(f.origin, [f.role], async (connection) => { effects += 1; expect((await f.rows())[0]!.storage_before).toEqual(storage); await connection.query('CREATE ROLE "' + f.role + '" NOLOGIN'); });
  expect(effects).toBe(1);
  expect((await f.rows())[0]!.storage_after).toEqual(storage);
}, observedSource((count) => { if (count === 1) throw precondition('source measurement busy', { code: 'native_postgres_source_busy' }); return storage; })));

test.skipIf(!available)('原生身份：来源字段先核验，额外业务字段不存入持久身份，非法原卷零副作用', () => fixture(async (f) => {
  await f.work.native.run(f.origin, [f.role], async () => undefined);
  expect((await f.rows())[0]!.storage_before).toEqual(storage);
  const unsafe = nativePostgresWork({ db: f.database.db, adminUrl, source: observedSource(() => ({ ...storage, volumes: [] })) });
  let effects = 0;
  await expect(unsafe.native.run(f.origin, [f.role], async () => { effects += 1; })).rejects.toThrow();
  expect(effects).toBe(0);
  expect((await f.rows())[1]!.catalog_before).toBeNull();
}, observedSource(() => ({ ...storage, password: 'must-not-be-stored' }))));

test.skipIf(!available)('原生身份：尚无独立来源适配器的既有供给仍可 CREATE，缺失来源保留为 NULL', () => fixture(async (f) => {
  await f.work.native.run(f.origin, [f.name, f.role], async (connection) => { await connection.query('CREATE ROLE "' + f.role + '" NOLOGIN'); await connection.query('CREATE DATABASE "' + f.name + '" OWNER "' + f.role + '"'); });
  const [record] = (await f.work.journal.read(f.origin.projectId)).records;
  expect(record).toMatchObject({ state: 'finished', before: { catalog: [], storage: null }, after: { storage: null } });
  expect(record!.after!.catalog).toHaveLength(2);
}, observedSource(() => { throw precondition('unregistered external source adapter', { code: 'native_postgres_source_unsupported' }); })));

test.skipIf(!available)('原生身份：已有原卷来源的回调后置适配器失效，保留 SQL 事实但不能成功', () => fixture(async (f) => {
  await expect(f.work.native.run(f.origin, [f.role], (connection) => connection.query('CREATE ROLE "' + f.role + '" NOLOGIN'))).rejects.toThrow('unregistered post source');
  expect((await f.rows())[0]).toMatchObject({ state: 'finished', storage_before: storage, storage_after: null });
  expect((await f.rows())[0]!.catalog_after).toHaveLength(1);
}, observedSource((count) => { if (count > 1) throw precondition('unregistered post source', { code: 'native_postgres_source_unsupported' }); return storage; })));

test.skipIf(!available)('原生身份：首次未知而后置可观测只记录后置事实，不倒填原未知来源', () => fixture(async (f) => {
  await f.work.native.run(f.origin, [f.role], (connection) => connection.query('CREATE ROLE "' + f.role + '" NOLOGIN'));
  expect((await f.rows())[0]).toMatchObject({ storage_before: null, storage_after: storage, catalog_before: [] });
  expect((await f.rows())[0]!.catalog_after).toHaveLength(1);
}, observedSource((count) => { if (count === 1) throw precondition('unregistered initial source', { code: 'native_postgres_source_unsupported' }); return storage; })));

test.skipIf(!available)('原生身份：迁移保留旧回调所有原字段，缺失历史不能凭当前 SQL 补造', async () => {
  const old = await createTestDatabase([{ ...dataControlMigrations, files: dataControlMigrations.files.filter((file) => file.name < '0005_native_identity_journal.sql') }]);
  const origin = { projectId: Bun.randomUUIDv7() as ProjectId, resourceId: Bun.randomUUIDv7() }, name = 'cs_journal_upgrade';
  try {
    const work = nativePostgresWork({ db: old.db, adminUrl });
    await work.withResource(origin, async (guard) => {
      const [backend] = await guard.execute<{ pid: number }>('SELECT pg_backend_pid() AS pid');
      await old.db.transaction((tx) => tx.execute("INSERT INTO data_control.deletion_work(work_id,resource_id,project_id,backend_pid,names) VALUES ('original-work','" + origin.resourceId + "','" + origin.projectId + "'," + backend!.pid + ",'[\"" + name + "\"]'::jsonb)"));
    });
    const before = await old.db.execute<Record<string, unknown>>('SELECT * FROM data_control.deletion_work');
    expect(await runMigrations(old.db, [dataControlMigrations])).toEqual(['data_control/0005_native_identity_journal.sql', 'data_control/0006_project_native_deletion.sql', 'data_control/0007_operator_confirmations.sql']);
    expect(await old.db.execute('SELECT * FROM data_control.operator_confirmations')).toHaveLength(0);
    const [after] = await old.db.execute<Record<string, unknown>>('SELECT * FROM data_control.deletion_work');
    const { catalog_before, catalog_after, storage_before, storage_after, journal_version, ...original } = after!;
    expect(original).toEqual(before[0]!);
    expect([catalog_before, catalog_after, storage_before, storage_after, journal_version]).toEqual([null, null, null, null, null]);
  } finally { await old.drop(); }
});

test.skipIf(!available)('原生身份公开端口：完整分页保留旧记录和在途事实，并在同一快照内排除并发新增及退出', () => fixture(async (f) => {
  await f.work.withResource(f.origin, async (guard) => {
    const [backend] = await guard.execute<{ pid: number }>('SELECT pg_backend_pid() AS pid');
    await f.database.db.transaction((tx) => tx.execute(sql`INSERT INTO data_control.deletion_work(work_id,resource_id,project_id,backend_pid,names) SELECT 'legacy-'||lpad(n::text,5,'0'),${f.origin.resourceId},${f.origin.projectId},${backend!.pid},jsonb_build_array(${f.role}::text) FROM generate_series(1,501) AS n`));
  });
  const other = { projectId: Bun.randomUUIDv7() as ProjectId, resourceId: Bun.randomUUIDv7() };
  await f.work.native.run(other, [f.role], async () => undefined);
  const before = await f.work.journal.read(f.origin.projectId);
  expect(before.retainedRecordsComplete).toBe(true); expect(before.records).toHaveLength(501);
  expect(before.records.every((record) => record.projectId === f.origin.projectId && record.journalVersion === null && record.before === null && record.after === null && record.state === 'running')).toBe(true);
  let interleaved = false;
  const db = new Proxy(f.database.db, { get(target, key, receiver) {
    if (key !== 'transaction') return Reflect.get(target, key, receiver);
    return (work: Parameters<typeof target.transaction>[0], config?: Parameters<typeof target.transaction>[1]) => target.transaction(async (tx) => work(new Proxy(tx, { get(current, field, currentReceiver) {
      if (field !== 'execute') return Reflect.get(current, field, currentReceiver);
      return async (...args: Parameters<typeof current.execute>) => {
        const rows = await current.execute(...args);
        if (!interleaved && rows.some((row) => row['work_id'] === 'legacy-00001')) {
          interleaved = true;
          await f.database.db.transaction(async (writer) => {
            await writer.execute("SELECT set_config('crewstation.data_control_work_exit','legacy-00501',true)");
            await writer.execute("UPDATE data_control.deletion_work SET state='finished' WHERE work_id='legacy-00501'");
          });
          await f.work.native.run(f.origin, [f.role], async () => undefined);
        }
        return rows;
      };
    } })), config);
  } });
  const snapshot = await nativePostgresWork({ db, adminUrl }).journal.read(f.origin.projectId);
  expect(interleaved).toBe(true); expect(snapshot).toEqual(before);
  const after = await f.work.journal.read(f.origin.projectId);
  expect(after.records).toHaveLength(502); expect(after.revision).not.toBe(before.revision);
  expect(after.records.find((record) => record.workId === 'legacy-00501')!.state).toBe('finished');
  await f.database.handle.close();
  await expect(f.work.journal.read(f.origin.projectId)).rejects.toBeDefined();
}));

test.skipIf(!available)('原生身份：项目关闭拒绝继续 DDL，原锁下的后置只读事实仍保存已提交 OID', () => fixture(async (f) => {
  let admitted = true;
  const source = observedSource(async (count) => {
    if (count === 2) {
      const [work] = await f.database.db.execute<{ backend_pid: number }>('SELECT backend_pid FROM data_control.deletion_work');
      const [actual] = await f.admin.unsafe<{ query: string; state: string }[]>('SELECT query,state FROM pg_stat_activity WHERE pid=$1', [work!.backend_pid]);
      expect(actual).toMatchObject({ query: 'SELECT 1', state: 'idle in transaction' });
    }
    return storage;
  });
  const work = nativePostgresWork({ db: f.database.db, adminUrl, source, available: async () => { if (!admitted) throw precondition('project admission closed'); } });
  // 原生 CREATE 已提交后接受删除，写入许可关闭不能同时丢掉原回调的后置事实。
  await expect(work.native.run(f.origin, [f.role], async (connection) => {
    await connection.query('CREATE ROLE "' + f.role + '" NOLOGIN');
    admitted = false;
    await connection.query('DROP ROLE "' + f.role + '"');
  })).rejects.toThrow('project admission closed');
  const [role] = await f.admin.unsafe<{ oid: string }[]>('SELECT oid::text FROM pg_roles WHERE rolname=$1', [f.role]);
  expect(role?.oid).toBeDefined();
  expect((await f.rows())[0]).toMatchObject({ state: 'finished', catalog_before: [], catalog_after: [{ kind: 'role', name: f.role, oid: role!.oid }], storage_before: storage, storage_after: storage });
}));

test.skipIf(!available)('原生身份公开端口：真实回调内读取独立快照，准入注入不能使隔离设置迟到', () => fixture(async (f) => {
  // 实际 API 曾在此路径先注入准入 SELECT，再 SET TRANSACTION，被 PostgreSQL 拒绝。
  await f.work.native.run(f.origin, [f.role], async (connection) => {
    const [session] = await connection.query<{ pid: number }[]>('SELECT pg_backend_pid() AS pid');
    const report = await f.work.journal.read(f.origin.projectId);
    expect(report.retainedRecordsComplete).toBe(true);
    expect(report.records).toHaveLength(1);
    expect(report.records[0]).toMatchObject({ state: 'running', nativeSession: { pid: session!.pid }, before: { catalog: [], storage }, after: null });
    const [answer] = await connection.query<{ one: number }[]>('SELECT 1 AS one');
    expect(answer?.one).toBe(1);
  });
  expect((await f.work.journal.read(f.origin.projectId)).records[0]).toMatchObject({ state: 'finished', after: { catalog: [], storage } });
}, observedSource()));

test.skipIf(!available)('原生身份公开端口：模块组合导出原项目完整记录；来源缺失、空范围不冒充物理完成', () => fixture(async (f) => {
  const control = createDataControlModule({ db: f.database.db, adminUrl, nativePostgresSource: observedSource(), ledger: { get: async () => undefined, listLive: async () => [], latestChange: async () => 0, changesSince: async () => [], observe: async () => ({ status: 'unchanged' }) } });
  try {
    await control.api.nativePostgres!.run(f.origin, [f.role], async () => undefined);
    const report = await control.api.nativePostgresJournal!.read(f.origin.projectId);
    expect(report.records).toHaveLength(1);
    expect(report.records[0]).toMatchObject({ projectId: f.origin.projectId, resourceId: f.origin.resourceId, journalVersion: 1, state: 'finished', process: null, proofDigest: null, before: { catalog: [], storage }, after: { catalog: [], storage } });
    expect(report.records[0]!.nativeSession!.pid).toBeGreaterThan(0);
    const other = await control.api.nativePostgresJournal!.read(Bun.randomUUIDv7() as ProjectId);
    expect(other.records).toEqual([]); expect(other.revision).not.toBe(report.revision);
  } finally { await control.observer.stop(); }
}, observedSource()));
