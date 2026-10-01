import { expect, test } from 'bun:test';
import postgres from 'postgres';
import { sql } from 'drizzle-orm';
import type { ProjectId } from '@crewstation/contracts';
import { testDatabaseAvailable } from '@crewstation/testkit';
import { withExclusiveDatabaseAdmission, withSharedDatabaseAdmission } from '@crewstation/persistence';
import { jsonHash } from '@crewstation/kernel';
import { nativeOwnerFixture, fixtureError, nativeOwnerUrl } from './nativeDeletionFixture';
import { nativeAdmissionKey } from '../adapters/persistence/nativeWork';
import { withNativePostgresNames } from '../adapters/postgres/nativeNames';
import { postgresNativeDeletionPhysics } from '../adapters/postgres/databaseReclamation';
import type { NativeDeletionScope } from '../ports/dataPlane';
import { createTestDatabase } from '@crewstation/testkit';
import { runMigrations } from '@crewstation/persistence';
import { createDataControlModule, dataControlMigrations } from '../wiring';
import { nativePostgresWork } from '../adapters/persistence/nativeWork';

const available = await testDatabaseAvailable();
test.skipIf(!available)('原生 owner：真实库/角色/目录按全部阶段清理，重建 owner 接管同范围，最终只留最小墓碑', () => nativeOwnerFixture(async (f) => {
  const original = await f.catalog(), report = await f.owner().inspect(f.target);
  expect(report).toMatchObject({ participant: 'data-control', complete: true, blockers: [], references: [] });
  expect(report.resources.filter((entry) => entry.count && entry.scope === 'physical')).toHaveLength(2);
  expect(JSON.stringify(report)).not.toContain('secretBox'); expect(JSON.stringify(report)).not.toContain('postgres://');
  for (const phase of ['seal', 'stop', 'purge', 'prove', 'namespace', 'metadata', 'verify'] as const) expect(await f.owner().run(f.context(report, phase))).toMatchObject({ kind: 'done', evidence: { kind: ['stop', 'purge', 'prove', 'verify'].includes(phase) ? 'physical' : phase === 'namespace' ? 'not-applicable' : 'metadata' } });
  expect(await f.catalog()).toHaveLength(0);
  for (const entry of original) if (entry.kind === 'database') expect((await f.admin.unsafe('SELECT (pg_stat_file($1,true)).isdir AS directory', ['base/' + entry.oid]))[0]?.directory).toBeNull();
  const counts = await f.database.db.execute<{ entities: string; credentials: string; work: string; scopes: string }>('SELECT (SELECT count(*)::text FROM data_control.deletion_entities) AS entities,(SELECT count(*)::text FROM data_control.credentials) AS credentials,(SELECT count(*)::text FROM data_control.deletion_work) AS work,(SELECT count(*)::text FROM data_control.deletion_scopes) AS scopes');
  expect(counts[0]).toEqual({ entities: '0', credentials: '0', work: '0', scopes: '0' });
  expect((await f.database.db.execute<{ scope_verified: boolean; completed_digest: string; completed_count: number }>('SELECT scope_verified,completed_digest,completed_count FROM data_control.deletion_fences'))[0]).toMatchObject({ scope_verified: true, completed_digest: expect.stringMatching(/^[a-f0-9]{64}$/), completed_count: 2 });
  expect(await f.owner().run(f.context(report, 'verify'))).toMatchObject({ kind: 'done' });
  await expect(f.owner().run(f.context(report, 'seal'))).rejects.toThrow('原操作');
  await expect(f.module.api.nativePostgres!.run(f.origin, [f.role], async () => undefined)).rejects.toThrow('永久清理');
  expect(f.nativeGuards.length).toBeGreaterThan(10);
}), 20_000);

test.skipIf(!available)('原生 owner：封闭等待实际 shared 准入，旧口令和全部迟到 native 写入被拒绝', () => nativeOwnerFixture(async (f) => {
  const report = await f.owner().inspect(f.target), entered = Promise.withResolvers<void>(), release = Promise.withResolvers<void>();
  const holder = withSharedDatabaseAdmission(f.database.db, nativeAdmissionKey(f.origin.projectId), async () => { entered.resolve(); await release.promise; });
  await entered.promise;
  let sealed = false; const closing = f.owner().run(f.context(report, 'seal')).then((result) => { sealed = true; return result; });
  try { await Bun.sleep(30); expect(sealed).toBe(false); }
  finally { release.resolve(); await holder; }
  expect(await closing).toMatchObject({ kind: 'done' });
  await expect(f.module.api.credentialOf(f.origin.resourceId)).rejects.toThrow('永久清理');
  await expect(f.module.api.nativePostgres!.credential!(f.origin, f.role)).rejects.toThrow('永久清理');
  expect(await f.catalog()).toHaveLength(2);
}));

test.skipIf(!available)('原生 owner：存在真实连接、预备事务或原名字锁就等待，不能用 finished JS 回执冒充排空', () => nativeOwnerFixture(async (f) => {
  const report = await f.owner().inspect(f.target); await f.owner().run(f.context(report, 'seal'));
  const databaseUrl = new URL(nativeOwnerUrl); databaseUrl.pathname = '/' + f.name;
  const consumer = postgres(databaseUrl.toString(), { max: 1 }); await consumer`SELECT 1`;
  try { expect(await f.owner().run(f.context(report, 'stop'))).toMatchObject({ kind: 'waiting' }); }
  finally { await consumer.end(); }
  const gid = 'owner_target_' + f.origin.resourceId.replaceAll('-', ''), prepared = postgres(databaseUrl.toString(), { max: 1 });
  const rollback = async () => {
    if ((await f.admin.unsafe('SELECT 1 FROM pg_prepared_xacts WHERE gid=$1', [gid])).length) {
      const recovery = postgres(databaseUrl.toString(), { max: 1 }); try { await recovery.unsafe("ROLLBACK PREPARED '" + gid + "'"); } finally { await recovery.end(); }
    }
  };
  f.finalizers.push(rollback);
  try { await prepared.unsafe('BEGIN'); await prepared.unsafe('SELECT 1'); await prepared.unsafe("PREPARE TRANSACTION '" + gid + "'"); } finally { await prepared.end(); }
  expect(await f.admin.unsafe('SELECT 1 FROM pg_prepared_xacts WHERE gid=$1', [gid])).toHaveLength(1);
  expect(await f.owner().run(f.context(report, 'stop'))).toMatchObject({ kind: 'waiting' });
  await rollback();
  const entered = Promise.withResolvers<void>(), release = Promise.withResolvers<void>();
  const holder = withNativePostgresNames(nativeOwnerUrl, [f.name], async () => { entered.resolve(); await release.promise; }); await entered.promise;
  try { expect(await f.owner().run(f.context(report, 'stop'))).toMatchObject({ kind: 'waiting' }); }
  finally { release.resolve(); await holder; }
  await f.admin.unsafe('BEGIN'); await f.admin.unsafe('SELECT 1'); const transaction = 'owner_' + f.origin.resourceId;
  await f.admin.unsafe("PREPARE TRANSACTION '" + transaction + "'");
  // Root-owner prepared work is outside the selected DB/roles and must remain untouched.
  expect(await f.owner().run(f.context(report, 'stop'))).toMatchObject({ kind: 'done' });
  await f.admin.unsafe("ROLLBACK PREPARED '" + transaction + "'");
}));

test.skipIf(!available)('原生 owner：DROP 已提交但阶段回执丢失，重启后按同一原 OID 和持久意图继续', () => nativeOwnerFixture(async (f) => {
  const report = await f.owner().inspect(f.target); await f.owner().run(f.context(report, 'seal')); await f.owner().run(f.context(report, 'stop'));
  let interrupted = false;
  f.verificationHook(async (connection) => {
    if (!interrupted && !(await connection.query('SELECT 1 FROM pg_database WHERE oid=$1::oid', [f.databaseOids[0]!])).length) { interrupted = true; f.expireGrant(); }
  });
  await expect(f.owner().run(f.context(report, 'purge'))).rejects.toThrow('expired');
  expect(interrupted).toBe(true); expect(await f.admin.unsafe('SELECT 1 FROM pg_database WHERE oid=$1::oid', [f.databaseOids[0]!])).toHaveLength(0);
  expect((await f.database.db.execute<{ purge_digest: string | null; count: string }>('SELECT purge_digest,(SELECT count(*)::text FROM data_control.credentials) AS count FROM data_control.deletion_scopes'))[0]).toEqual({ purge_digest: null, count: '1' });
  f.restoreGrant(); f.verificationHook(); const generation = f.takeover();
  await expect(f.owner().run(f.context(report, 'purge'))).rejects.toThrow('expired');
  for (const phase of ['purge', 'prove', 'metadata', 'verify'] as const) expect(await f.owner().run({ ...f.context(report, phase), generation })).toMatchObject({ kind: 'done' });
  expect(await f.owner().run({ ...f.context(report, 'verify'), generation: f.takeover() })).toMatchObject({ kind: 'done' });
  expect(await f.catalog()).toHaveLength(0);
}), 20_000);

test.skipIf(!available)('原生 physics：finished 行不替代原 PID/start/服务器的真实排空，不杀其他管理连接', () => nativeOwnerFixture(async (f) => {
  const report = await f.owner().inspect(f.target); await f.owner().run(f.context(report, 'seal'));
  const [row] = await f.database.db.execute<{ original: NativeDeletionScope }>('SELECT original FROM data_control.deletion_scopes');
  const peer = postgres(nativeOwnerUrl, { max: 1 });
  const [native] = await peer.unsafe<{ pid: number; started: string; identifier: string }[]>("SELECT pg_backend_pid() AS pid,(SELECT backend_start::text FROM pg_stat_activity WHERE pid=pg_backend_pid()) AS started,(SELECT system_identifier::text FROM pg_control_system()) AS identifier");
  const endpoint = new URL(nativeOwnerUrl); endpoint.username = ''; endpoint.password = ''; endpoint.pathname = '/postgres';
  const scope = { ...row!.original, plan: { ...row!.original.plan, sessions: [{ pid: native!.pid, started: native!.started, sourceIdentity: jsonHash({ endpoint: endpoint.toString(), identifier: native!.identifier }) }] } };
  const physics = postgresNativeDeletionPhysics({ adminUrl: nativeOwnerUrl, source: f.source, reader: f.module.api.databaseReclamation!, assertGrant: async () => undefined });
  try { expect(await physics.stop(scope)).toMatchObject({ kind: 'waiting' }); expect((await peer.unsafe('SELECT 42 AS result'))[0]?.result).toBe(42); }
  finally { await peer.end(); }
  expect(await physics.stop(scope)).toMatchObject({ kind: 'done' });
}));

test.skipIf(!available)('原生 owner：盘点前跨库对象或外部角色成员阻断确认，所有原库与外国对象保持', () => nativeOwnerFixture(async (f) => {
  const foreign = 'cs_foreign_' + Bun.randomUUIDv7().replaceAll('-', '').slice(-12); f.roleNames.push(foreign);
  await f.admin.unsafe('CREATE ROLE "' + foreign + '" NOLOGIN');
  const before = await f.catalog();
  await f.admin.unsafe('GRANT "' + f.role + '" TO "' + foreign + '"');
  try {
    const report = await f.owner().inspect(f.target);
    expect(report.complete).toBe(false);
    expect(report.blockers).toEqual(expect.arrayContaining([expect.objectContaining({ code: 'native-foreign-dependencies' })]));
    await expect(f.owner().run(f.context(report, 'seal'))).rejects.toThrow('完整确认');
    expect(await f.catalog()).toEqual(before);
  } finally { await f.admin.unsafe('REVOKE "' + f.role + '" FROM "' + foreign + '"'); }
  const table = 'native_foreign_' + f.origin.resourceId.replaceAll('-', '');
  await f.admin.unsafe('CREATE TABLE "' + table + '"(id integer)');
  await f.admin.unsafe('ALTER TABLE "' + table + '" OWNER TO "' + f.role + '"');
  try {
    const report = await f.owner().inspect(f.target);
    expect(report.complete).toBe(false);
    expect(report.blockers).toEqual(expect.arrayContaining([expect.objectContaining({ code: 'native-foreign-dependencies' })]));
    expect(await f.catalog()).toEqual(before);
    expect(await f.admin.unsafe('SELECT * FROM "' + table + '"')).toHaveLength(0);
  } finally { await f.admin.unsafe('DROP TABLE "' + table + '"'); }
  expect((await f.owner().inspect(f.target)).complete).toBe(true);
}));

test.skipIf(!available)('原生 owner：DROP 后出现的外部角色依赖阻止继续，保留凭据并可继续同操作', () => nativeOwnerFixture(async (f) => {
  const foreign = 'cs_foreign_' + Bun.randomUUIDv7().replaceAll('-', '').slice(-12); f.roleNames.push(foreign);
  await f.admin.unsafe('CREATE ROLE "' + foreign + '" NOLOGIN');
  const report = await f.owner().inspect(f.target); await f.owner().run(f.context(report, 'seal')); await f.owner().run(f.context(report, 'stop'));
  let injected = false;
  f.verificationHook(async (connection) => {
    if (!injected && !(await connection.query('SELECT 1 FROM pg_database WHERE oid=$1::oid', [f.databaseOids[0]!])).length) { injected = true; await connection.query('GRANT "' + f.role + '" TO "' + foreign + '"'); }
  });
  expect(await f.owner().run(f.context(report, 'purge'))).toMatchObject({ kind: 'waiting' });
  expect(await f.admin.unsafe('SELECT 1 FROM pg_database WHERE datname=$1', [f.name])).toHaveLength(0);
  expect(await f.admin.unsafe('SELECT 1 FROM pg_roles WHERE rolname=$1', [foreign])).toHaveLength(1);
  await expect(f.owner().run(f.context(report, 'metadata'))).rejects.toThrow('尚未');
  expect((await f.database.db.execute<{ count: string }>('SELECT count(*)::text AS count FROM data_control.credentials'))[0]?.count).toBe('1');
  await f.admin.unsafe('REVOKE "' + f.role + '" FROM "' + foreign + '"'); f.verificationHook();
  for (const phase of ['purge', 'prove', 'metadata', 'verify'] as const) expect(await f.owner().run(f.context(report, phase))).toMatchObject({ kind: 'done' });
  expect(await f.admin.unsafe('SELECT 1 FROM pg_roles WHERE rolname=$1', [foreign])).toHaveLength(1);
}), 20_000);

test.skipIf(!available)('原生 owner：新 OID 同名数据库及独立卷替换都不能接管，原范围和凭据保持', () => nativeOwnerFixture(async (f) => {
  const report = await f.owner().inspect(f.target); await f.owner().run(f.context(report, 'seal')); await f.owner().run(f.context(report, 'stop'));
  await f.admin.unsafe('DROP DATABASE "' + f.name + '"'); await f.admin.unsafe('CREATE DATABASE "' + f.name + '"');
  const [replacement] = await f.admin.unsafe<{ oid: string }[]>('SELECT oid::text FROM pg_database WHERE datname=$1', [f.name]); f.databaseOids.push(replacement!.oid);
  await expect(f.owner().run(f.context(report, 'purge'))).rejects.toThrow('替换');
  expect(await f.admin.unsafe('SELECT 1 FROM pg_database WHERE oid=$1::oid', [replacement!.oid])).toHaveLength(1);
  f.replaceSource(); await expect(f.owner().run(f.context(report, 'stop'))).rejects.toThrow('replaced');
  expect((await f.database.db.execute<{ count: string }>('SELECT count(*)::text AS count FROM data_control.credentials'))[0]?.count).toBe('1');
}));

test.skipIf(!available)('原生 owner：缺少原世代、过期许可、外部引用及跳阶段均零秘密清理，SQL marker 不能伪造物理完成', () => nativeOwnerFixture(async (f) => {
  const report = await f.owner().inspect(f.target);
  await expect(f.owner().run({ ...f.context(report, 'seal'), confirmed: { ...report, complete: false } })).rejects.toThrow('完整确认');
  await expect(f.owner().run({ ...f.context(report, 'seal'), confirmed: { ...report, references: [{ kind: 'outside', id: 'other', description: 'foreign dependency' }] } })).rejects.toThrow('完整确认');
  await f.owner().run(f.context(report, 'seal'));
  await expect(f.owner().run(f.context(report, 'purge'))).rejects.toThrow('上一阶段');
  await expect(f.owner().run(f.context(report, 'verify'))).rejects.toThrow('上一阶段');
  await expect(f.owner().run({ ...f.context(report, 'stop'), generation: 2 })).rejects.toThrow('expired');
  f.expireGrant(); await expect(f.owner().run(f.context(report, 'stop'))).rejects.toThrow('expired'); f.restoreGrant();
  await expect(fixtureError(f.database.db.execute(sql`UPDATE data_control.deletion_fences SET scope_verified=true WHERE project_id=${f.origin.projectId}`))).rejects.toThrow('physical phase');
  await expect(fixtureError(f.database.db.transaction(async (tx) => { await tx.execute(sql`SELECT set_config('crewstation.data_control_deletion',${f.context(report, 'metadata').operationId},true),set_config('crewstation.data_control_deletion_phase','metadata',true),set_config('crewstation.data_control_deletion_generation','1',true)`); await tx.execute(sql`DELETE FROM data_control.credentials WHERE resource_id=${f.origin.resourceId}`); }))).rejects.toThrow('verified');
  await expect(fixtureError(f.database.db.execute(sql`UPDATE data_control.deletion_scopes SET original='{}'::jsonb WHERE project_id=${f.origin.projectId}`))).rejects.toThrow('exclusive');
  expect(await f.catalog()).toHaveLength(2);
}));

test.skipIf(!available)('原生 owner：确认后元数据变化只关准入，保留原内容，不自动绑定另一范围', () => nativeOwnerFixture(async (f) => {
  const report = await f.owner().inspect(f.target);
  await f.module.api.withCredentialAdmission(f.origin.resourceId, () => f.database.db.transaction(async (tx) => { await tx.execute(sql`UPDATE data_control.credentials SET pending_box='changed' WHERE resource_id=${f.origin.resourceId}`); }));
  expect(await f.owner().run(f.context(report, 'seal'))).toMatchObject({ kind: 'blocked' });
  expect((await f.database.db.execute<{ count: string }>('SELECT count(*)::text AS count FROM data_control.deletion_scopes'))[0]?.count).toBe('0');
  await expect(f.module.api.nativePostgres!.run(f.origin, [f.role], async () => undefined)).rejects.toThrow('永久清理');
  const updated = await f.owner().inspect(f.target), next = { ...f.context(updated, 'seal'), generation: f.takeover() };
  expect(await f.owner().run(next)).toMatchObject({ kind: 'done' });
}));

test.skipIf(!available)('原生 owner：确认后旧别名或上游保留历史变化必须重新确认，不能静默扩张密文清理范围', () => nativeOwnerFixture(async (f) => {
  const report = await f.owner().inspect(f.target), alias = Bun.randomUUIDv7();
  f.historyValue.records[0]!.aliases = [alias]; f.historyValue.revision = jsonHash('changed-retained-history');
  expect(await f.owner().run(f.context(report, 'seal'))).toMatchObject({ kind: 'blocked' });
  expect(await f.database.db.execute('SELECT 1 FROM data_control.deletion_scopes')).toHaveLength(0);
  expect(await f.database.db.execute(sql`SELECT 1 FROM data_control.deletion_entities WHERE resource_id=${alias}`)).toHaveLength(0);
  const current = await f.owner().inspect(f.target), generation = f.takeover();
  expect(current.revision).not.toBe(report.revision);
  for (const phase of ['seal', 'stop', 'purge', 'prove', 'metadata', 'verify'] as const) expect(await f.owner().run({ ...f.context(current, phase), generation })).toMatchObject({ kind: 'done' });
  expect(await f.catalog()).toHaveLength(0);
}));

test.skipIf(!available)('原生 owner：旧 journal NULL 和未知凭据不能被当前 SQL 观测补造成完整历史', () => nativeOwnerFixture(async (f) => {
  // A genuine legacy row is inserted under the real shared admission; it never receives v1 facts.
  const legacy = Bun.randomUUIDv7();
  await withSharedDatabaseAdmission(f.database.db, nativeAdmissionKey(f.origin.projectId), async (guard) => {
    const [backend] = await guard.execute<{ pid: number }>(sql`SELECT pg_backend_pid() AS pid`);
    await f.database.db.transaction(async (tx) => { await tx.execute(sql`INSERT INTO data_control.deletion_work(work_id,resource_id,project_id,backend_pid,names) VALUES (${legacy},${f.origin.resourceId},${f.origin.projectId},${backend!.pid},${JSON.stringify([f.name])}::jsonb)`); });
  });
  const report = await f.owner().inspect(f.target);
  expect(report.complete).toBe(false); expect(report.blockers).toEqual(expect.arrayContaining([expect.objectContaining({ code: 'native-history-unrecorded' })]));
  expect(await f.catalog()).toHaveLength(2);
}));

test.skipIf(!available)('原生 owner：从未有物理资源的原名字按 absent 固定，新实体出现后拒绝回收', () => nativeOwnerFixture(async (f) => {
  await f.module.api.nativePostgres!.run(f.origin, [f.name, f.role], async () => undefined);
  const report = await f.owner().inspect(f.target); expect(report.complete).toBe(true);
  expect(report.resources.filter((entry) => entry.scope === 'physical').every((entry) => entry.count === 0)).toBe(true);
  await f.owner().run(f.context(report, 'seal'));
  await f.admin.unsafe('CREATE ROLE "' + f.role + '" NOLOGIN');
  await expect(f.owner().run(f.context(report, 'stop'))).rejects.toThrow('新原生实体');
}, false));

test.skipIf(!available)('原生 owner：没有独立原生记录的声明即使当前 absent 也不报告物理历史完整', () => nativeOwnerFixture(async (f) => {
  const report = await f.owner().inspect(f.target);
  expect(report.complete).toBe(false); expect(report.blockers).toEqual(expect.arrayContaining([expect.objectContaining({ code: 'native-name-history-unrecorded' })]));
  expect(report.resources.filter((entry) => entry.scope === 'physical')).toHaveLength(0);
  expect(await f.catalog()).toHaveLength(0);
}, false));

test.skipIf(!available)('原生 owner：1002 个原实体/凭据完整分页，seal 丢回执重试复用同范围，清除全部密文', () => nativeOwnerFixture(async (f) => {
  await withSharedDatabaseAdmission(f.database.db, nativeAdmissionKey(f.origin.projectId), async () => f.database.db.transaction(async (tx) => {
    await tx.execute(sql`INSERT INTO data_control.deletion_entities(resource_id,project_id) SELECT left(${f.origin.resourceId},24)||lpad(n::text,12,'0'),${f.origin.projectId} FROM generate_series(1,1001) n`);
    await tx.execute(sql`INSERT INTO data_control.credentials(resource_id,role,secret_box,pending_box) SELECT resource_id,${f.role},'retained-ciphertext','retained-pending-ciphertext' FROM data_control.deletion_entities WHERE project_id=${f.origin.projectId} AND resource_id<>${f.origin.resourceId}`);
  }));
  const report = await f.owner().inspect(f.target);
  expect(report.resources.find((row) => row.kind === 'metadata:credentials')?.count).toBe(1002);
  expect(report.resources.find((row) => row.kind === 'metadata:deletion_entities')?.count).toBe(1002);
  expect(JSON.stringify(report)).not.toContain('retained-ciphertext');
  expect(await f.owner().run(f.context(report, 'seal'))).toMatchObject({ kind: 'done' });
  expect(await f.owner().run(f.context(report, 'seal'))).toMatchObject({ kind: 'done' });
  for (const phase of ['stop', 'purge', 'prove', 'metadata', 'verify'] as const) expect(await f.owner().run(f.context(report, phase))).toMatchObject({ kind: 'done' });
  expect((await f.database.db.execute<{ count: string }>('SELECT count(*)::text AS count FROM data_control.credentials'))[0]?.count).toBe('0');
}), 20_000);

test.skipIf(!available)('原生 owner 迁移：旧密文/待轮换材料和 NULL 来源逐字保留，不自动补造身份或回收完成', async () => {
  const old = await createTestDatabase([{ ...dataControlMigrations, files: dataControlMigrations.files.filter((file) => file.name < '0006_project_native_deletion.sql') }]);
  const origin = { projectId: Bun.randomUUIDv7() as ProjectId, resourceId: Bun.randomUUIDv7() };
  const work = nativePostgresWork({ db: old.db, adminUrl: nativeOwnerUrl });
  try {
    await work.withResource(origin, () => old.db.transaction(async (tx) => { await tx.execute(sql`INSERT INTO data_control.credentials(resource_id,role,secret_box,pending_box) VALUES (${origin.resourceId},'cs_upgrade_role','original-box','original-pending-box')`); }));
    await work.native.run(origin, ['cs_upgrade_role'], async () => undefined);
    const before = { credentials: [...await old.db.execute('SELECT * FROM data_control.credentials')], work: [...await old.db.execute('SELECT * FROM data_control.deletion_work')] };
    expect(await runMigrations(old.db, [dataControlMigrations])).toEqual(['data_control/0006_project_native_deletion.sql']);
    expect([...await old.db.execute('SELECT * FROM data_control.credentials')]).toEqual(before.credentials);
    expect([...await old.db.execute('SELECT * FROM data_control.deletion_work')]).toEqual(before.work);
    expect((await work.journal.read(origin.projectId)).records[0]).toMatchObject({ before: { storage: null }, after: { storage: null } });
    expect([...await old.db.execute('SELECT * FROM data_control.deletion_scopes')]).toHaveLength(0);
  } finally { await old.drop(); }
});

test.skipIf(!available)('原生 owner：升级前孤立凭据没有原项目归属，空历史也不能将其默认为其他项目或清理成功', () => nativeOwnerFixture(async (f) => {
  const old = await createTestDatabase([{ ...dataControlMigrations, files: dataControlMigrations.files.filter((file) => file.name < '0004_native_work.sql') }]), unknown = Bun.randomUUIDv7();
  let module: ReturnType<typeof createDataControlModule> | undefined;
  try {
    await old.db.execute(sql`INSERT INTO data_control.credentials(resource_id,role,secret_box,pending_box) VALUES (${unknown},'cs_unowned_legacy','old-unowned-box','old-pending-box')`);
    const before = [...await old.db.execute('SELECT * FROM data_control.credentials')];
    await runMigrations(old.db, [dataControlMigrations]);
    module = createDataControlModule({ db: old.db, adminUrl: nativeOwnerUrl, nativePostgresSource: f.source, ledger: { get: async () => undefined, listLive: async () => [], changesSince: async () => [], latestChange: async () => 0, observe: async () => ({ status: 'unchanged' }) } });
    const owner = module.api.projectDeletion!.owner({ history: { read: async () => ({ complete: true, revision: jsonHash('empty-history'), records: [], blockers: [], references: [] }) }, assertGrant: async () => undefined });
    const report = await owner.inspect(f.target);
    expect(report.complete).toBe(false);
    expect(report.blockers).toEqual(expect.arrayContaining([expect.objectContaining({ code: 'native-credential-owner-unknown' })]));
    await expect(owner.run(f.context(report, 'seal'))).rejects.toThrow('完整确认');
    expect([...await old.db.execute('SELECT * FROM data_control.credentials')]).toEqual(before);
    expect([...await old.db.execute('SELECT * FROM data_control.deletion_entities')]).toHaveLength(0);
    expect(JSON.stringify(report)).not.toContain('old-unowned-box');
  } finally { await module?.observer.stop(); await old.drop(); }
}, false));

test.skipIf(!available)('原生 owner：其他项目原实体与凭据不被清理，旧别名不能跨项目认领', () => nativeOwnerFixture(async (f) => {
  const foreign = { projectId: Bun.randomUUIDv7() as ProjectId, resourceId: Bun.randomUUIDv7() }, foreignRole = 'cs_other_' + Bun.randomUUIDv7().replaceAll('-', '').slice(-12); f.roleNames.push(foreignRole);
  await f.module.api.nativePostgres!.credential!(foreign, foreignRole);
  await f.module.api.nativePostgres!.run(foreign, [foreignRole], (connection) => connection.query('CREATE ROLE "' + foreignRole + '" NOLOGIN'));
  f.historyValue.records[0]!.aliases = [foreign.resourceId];
  expect((await f.owner().inspect(f.target)).blockers).toEqual(expect.arrayContaining([expect.objectContaining({ code: 'native-owner-conflict' })]));
  f.historyValue.records[0]!.aliases = [];
  const report = await f.owner().inspect(f.target);
  for (const phase of ['seal', 'stop', 'purge', 'prove', 'metadata', 'verify'] as const) expect(await f.owner().run(f.context(report, phase))).toMatchObject({ kind: 'done' });
  expect(await f.admin.unsafe('SELECT 1 FROM pg_roles WHERE rolname=$1', [foreignRole])).toHaveLength(1);
  expect((await f.database.db.execute<{ count: string }>(sql`SELECT count(*)::text AS count FROM data_control.credentials WHERE resource_id=${foreign.resourceId}`))[0]?.count).toBe('1');
  await expect(fixtureError(withExclusiveDatabaseAdmission(f.database.db, nativeAdmissionKey(f.origin.projectId), async (tx) => { await tx.execute(sql`DELETE FROM data_control.deletion_fences WHERE project_id=${f.origin.projectId}`); }))).rejects.toThrow('tombstone');
  expect(jsonHash(foreign)).toMatch(/^[a-f0-9]{64}$/);
}), 20_000);
