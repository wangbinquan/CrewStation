import { expect, test } from 'bun:test';
import postgres from 'postgres';
import type { ProjectId } from '@crewstation/contracts';
import { DEFAULT_TEST_DATABASE_URL, createTestDatabase, testDatabaseAvailable } from '@crewstation/testkit';
import { generateSecretKey } from '@crewstation/secretbox';
import { runMigrations } from '@crewstation/persistence';
import { secretboxCipher } from '../adapters/crypto/secretboxCipher';
import { nativePostgresWork } from '../adapters/persistence/nativeWork';
import { withNativePostgresNames } from '../adapters/postgres/nativeNames';
import { createDataControlModule, dataControlMigrations } from '../wiring';

const available = await testDatabaseAvailable(), adminUrl = process.env.CS_TEST_DATABASE_URL ?? DEFAULT_TEST_DATABASE_URL;
const originalProcess = { podUid: Bun.randomUUIDv7(), containerId: 'containerd://native-original', nodeUid: Bun.randomUUIDv7(), nodeName: 'original-node' };
function errorCause<T>(query: PromiseLike<T>): Promise<T> { return Promise.resolve(query).catch((error: unknown) => { throw error instanceof Error ? error.cause ?? error : error; }); }
async function until(check: () => Promise<boolean>) {
  const deadline = Date.now() + 3000;
  while (!await check()) { if (Date.now() > deadline) throw new Error('original native fact did not settle'); await Bun.sleep(10); }
}
async function fixture(run: (f: Awaited<ReturnType<typeof setup>>) => Promise<void>) {
  const f = await setup();
  try { await run(f); }
  finally { await f.admin.unsafe('DROP ROLE IF EXISTS "' + f.name + '"'); await f.admin.end(); await f.database.drop(); }
}
async function setup() {
  const database = await createTestDatabase([dataControlMigrations]), admin = postgres(adminUrl, { max: 1, onnotice: () => undefined });
  const origin = { projectId: Bun.randomUUIDv7() as ProjectId, resourceId: Bun.randomUUIDv7() };
  const name = 'cs_native_work_' + Bun.randomUUIDv7().replaceAll('-', '').slice(-16);
  let closed = false;
  const releasable: boolean[] = [];
  const work = nativePostgresWork({ db: database.db, adminUrl, available: async () => { if (closed) throw new Error('original project closed'); }, processes: { protectCurrent: async () => originalProcess, sweep: async (accept) => { releasable.push(await accept.releasable(originalProcess.podUid)); } } });
  const rows = () => database.db.execute<{ work_id: string; project_id: string; resource_id: string; backend_pid: number; native_pid: number | null; native_started: string | null; source_identity: string | null; names: string[]; state: string; proof_digest: string | null; pod_uid: string; container_id: string; node_uid: string; node_name: string }>('SELECT * FROM data_control.deletion_work ORDER BY work_id');
  return { database, admin, origin, name, work, rows, releasable, closeProject: () => { closed = true; } };
}

test.skipIf(!available)('原数据库写入：副作用前持久提交原来源，原资源归属不可替换，SQL 不能冒充回调退出', () => fixture(async (f) => {
  await f.work.native.run(f.origin, [f.name], async (connection) => {
    const [row] = await f.rows();
    expect(row).toMatchObject({ project_id: f.origin.projectId, resource_id: f.origin.resourceId, state: 'running', pod_uid: originalProcess.podUid, container_id: originalProcess.containerId, node_uid: originalProcess.nodeUid, node_name: originalProcess.nodeName, names: [f.name] });
    expect(row!.native_pid).toBeGreaterThan(0); expect(row!.native_started).toBeString(); expect(row!.source_identity).toMatch(/^[a-f0-9]{64}$/);
    await expect(errorCause(f.database.db.execute("UPDATE data_control.deletion_work SET state='finished'"))).rejects.toThrow('actual exit');
    await expect(errorCause(f.database.db.execute('DELETE FROM data_control.deletion_work'))).rejects.toThrow('not exited');
    await expect(errorCause(f.database.db.execute("UPDATE data_control.deletion_work SET resource_id='replacement'"))).rejects.toThrow('immutable');
    await f.work.sweep(); expect(f.releasable.at(-1)).toBe(false);
    await connection.query('CREATE ROLE "' + f.name + '" NOLOGIN');
  });
  expect((await f.rows())[0]?.state).toBe('finished');
  await expect(f.work.native.run({ ...f.origin, projectId: Bun.randomUUIDv7() as ProjectId }, [f.name], async () => undefined)).rejects.toThrow('不能转归');
  await expect(f.work.native.run(f.origin, ['postgres'], async () => undefined)).rejects.toThrow('名字锁');
  await expect(f.work.native.run({ ...f.origin, resourceId: '' }, [f.name], async () => undefined)).rejects.toThrow('身份');
  await f.work.sweep();
  expect(f.releasable.at(-1)).toBe(true);
}));

test.skipIf(!available)('原生名字锁等待后再查原项目准入，迟到的供给不能创建角色', () => fixture(async (f) => {
  const acquired = Promise.withResolvers<void>(), release = Promise.withResolvers<void>();
  const holder = withNativePostgresNames(adminUrl, [f.name], async () => { acquired.resolve(); await release.promise; });
  await acquired.promise;
  let effects = 0;
  const writer = f.work.native.run(f.origin, [f.name], async () => { effects += 1; }).then(() => 'unexpected', (error: Error) => error.message);
  try {
    await until(async () => (await f.rows()).some((row) => row.state === 'running'));
    expect((await f.rows())[0]?.native_pid).toBeNull();
    f.closeProject();
  } finally { release.resolve(); await holder; }
  expect(await writer).toContain('original project closed'); expect(effects).toBe(0);
  expect((await f.rows())[0]?.state).toBe('finished');
  expect(await f.admin.unsafe('SELECT 1 FROM pg_roles WHERE rolname=$1', [f.name])).toHaveLength(0);
}));

test.skipIf(!available)('主库真实 backend 退出不能提前释放原生锁或抹掉在途事实；实际 finally 后才结束', () => fixture(async (f) => {
  const entered = Promise.withResolvers<void>(), release = Promise.withResolvers<void>(), actualExit = Promise.withResolvers<void>();
  let effects = 0;
  const writer = f.work.native.run(f.origin, [f.name], async (connection) => {
    entered.resolve();
    try { await release.promise; await connection.query('CREATE ROLE "' + f.name + '" NOLOGIN'); effects += 1; }
    finally { actualExit.resolve(); }
  }).then(() => 'unexpected', (error: Error) => error.message);
  await entered.promise;
  const [original] = await f.rows();
  const main = postgres(f.database.url, { max: 1, onnotice: () => undefined });
  let acquired = false;
  const waiting = withNativePostgresNames(adminUrl, [f.name], async () => { acquired = true; });
  try {
    await main.unsafe('SELECT pg_terminate_backend($1)', [original!.backend_pid]);
    expect(await writer).not.toBe('unexpected');
    await Bun.sleep(30); expect(acquired).toBe(false); expect((await f.rows())[0]?.state).toBe('running');
    // The original callback remains alive after its caller has already received a failure.
    expect(effects).toBe(0);
  } finally { release.resolve(); await actualExit.promise; await waiting; await main.end(); }
  await until(async () => (await f.rows())[0]?.state === 'finished');
  expect(effects).toBe(0); expect(acquired).toBe(true);
  expect(await f.admin.unsafe('SELECT 1 FROM pg_roles WHERE rolname=$1', [f.name])).toHaveLength(0);
}), 15000);

test.skipIf(!available)('原回调已实际退出而主库回执写失败，恢复只接受原 Pod、容器、节点四键和停止摘要', () => fixture(async (f) => {
  await f.database.db.execute("CREATE FUNCTION data_control.fail_fixture_exit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.state='finished' THEN RAISE EXCEPTION 'fixture exit receipt unavailable'; END IF; RETURN NEW; END $$");
  await f.database.db.execute('CREATE TRIGGER fixture_exit_failure BEFORE UPDATE ON data_control.deletion_work FOR EACH ROW EXECUTE FUNCTION data_control.fail_fixture_exit()');
  let exited = false;
  await expect(errorCause(f.work.native.run(f.origin, [f.name], async () => { exited = true; }))).rejects.toThrow('receipt unavailable');
  expect(exited).toBe(true); expect((await f.rows())[0]?.state).toBe('running');
  await withNativePostgresNames(adminUrl, [f.name], async () => undefined);
  await f.database.db.execute('DROP TRIGGER fixture_exit_failure ON data_control.deletion_work');
  await f.database.db.execute('DROP FUNCTION data_control.fail_fixture_exit()');
  await expect(f.work.recover({ ...originalProcess, nodeUid: '' }, 'a'.repeat(64))).rejects.toThrow('不完整');
  await expect(f.work.recover(originalProcess, 'invalid')).rejects.toThrow('不完整');
  await f.work.recover({ ...originalProcess, containerId: 'containerd://replacement' }, 'a'.repeat(64));
  expect((await f.rows())[0]?.state).toBe('running');
  await f.work.recover(originalProcess, 'a'.repeat(64));
  expect((await f.rows())[0]).toMatchObject({ state: 'finished', proof_digest: 'a'.repeat(64) });
}));

test.skipIf(!available)('原生口令先独立提交且重试复用；关闭准入后停止续发，其他项目保留，旧资源不能改角色', () => fixture(async (f) => {
  const control = createDataControlModule({ db: f.database.db, adminUrl, secretKeyBase64: generateSecretKey(), ledger: { get: async (id) => id === f.origin.resourceId ? ({ id, projectId: f.origin.projectId, kind: 'database', desired: 'present', spec: { children: [] }, children: [] }) : undefined, listLive: async () => [], latestChange: async () => 0, changesSince: async () => [], observe: async () => ({ status: 'unchanged' }) } });
  try {
    await expect(errorCause(f.database.db.execute("INSERT INTO data_control.credentials(resource_id,role,secret_box) VALUES ('unknown','cs_unknown','not-a-secret')"))).rejects.toThrow('original project');
    const first = await control.api.nativePostgres!.credential!(f.origin, f.name);
    expect(await control.api.credentialOf(Bun.randomUUIDv7())).toBeUndefined();
    expect((await control.api.nativePostgres!.credential!(f.origin, f.name)).password).toBe(first.password);
    const [stored] = await f.database.db.execute<{ secret_box: string }>('SELECT secret_box FROM data_control.credentials');
    expect(stored!.secret_box).not.toContain(first.password);
    await expect(control.api.nativePostgres!.credential!(f.origin, f.name + '_other')).rejects.toThrow('不能改绑');
    const other = { projectId: Bun.randomUUIDv7() as ProjectId, resourceId: Bun.randomUUIDv7() }, otherRole = f.name + '_other';
    const preserved = await control.api.nativePostgres!.credential!(other, otherRole);
    expect((await control.api.credentialOf(other.resourceId))?.password).toBe(preserved.password);
    await f.database.db.execute("INSERT INTO data_control.deletion_fences(project_id,operation_id) VALUES ('" + f.origin.projectId + "','" + Bun.randomUUIDv7() + "')");
    await expect(control.api.credentialOf(f.origin.resourceId)).rejects.toThrow('永久清理');
    await expect(control.api.nativePostgres!.credential!(f.origin, f.name)).rejects.toThrow('永久清理');
    await expect(errorCause(f.database.db.execute("UPDATE data_control.credentials SET secret_box='late' WHERE resource_id='" + f.origin.resourceId + "'"))).rejects.toThrow('retired');
    expect((await control.api.nativePostgres!.credential!(other, otherRole)).password).toBe(preserved.password);
  } finally { await control.observer.stop(); }
}));

test.skipIf(!available)('原容器来源缺一键时拒绝外部 DDL，不补造 native work', () => fixture(async (f) => {
  let effects = 0;
  const incomplete = nativePostgresWork({ db: f.database.db, adminUrl, processes: { protectCurrent: async () => ({ ...originalProcess, nodeUid: '' }), sweep: async () => undefined } });
  await expect(incomplete.native.run(f.origin, [f.name], async () => { effects += 1; })).rejects.toThrow('来源不完整');
  expect(effects).toBe(0); expect(await f.rows()).toHaveLength(0);
}));

test.skipIf(!available)('旧口令库真实升级保留全部密文原文；原资源归属固定后才允许读取', async () => {
  const old = await createTestDatabase([{ ...dataControlMigrations, files: dataControlMigrations.files.filter((file) => file.name < '0004_native_work.sql') }]);
  const id = Bun.randomUUIDv7(), projectId = Bun.randomUUIDv7() as ProjectId, key = generateSecretKey(), password = 'OriginalUpgrade_1234567890', boxed = await secretboxCipher(key).encrypt(password);
  let control: ReturnType<typeof createDataControlModule> | undefined;
  try {
    await old.db.execute("INSERT INTO data_control.credentials(resource_id,role,secret_box) VALUES ('" + id + "','cs_upgrade_original','" + boxed + "')");
    const before = await old.db.execute('SELECT * FROM data_control.credentials');
    expect(await runMigrations(old.db, [dataControlMigrations])).toEqual(['data_control/0004_native_work.sql', 'data_control/0005_native_identity_journal.sql', 'data_control/0006_project_native_deletion.sql']);
    expect(await old.db.execute('SELECT * FROM data_control.credentials')).toEqual(before);
    expect(await old.db.execute('SELECT * FROM data_control.deletion_entities')).toHaveLength(0);
    const ledger = { get: async () => undefined, listLive: async () => [], latestChange: async () => 0, changesSince: async () => [], observe: async () => ({ status: 'unchanged' as const }) };
    control = createDataControlModule({ db: old.db, adminUrl, secretKeyBase64: key, ledger });
    await expect(control.api.credentialOf(id)).rejects.toThrow('原项目归属');
    await control.observer.stop();
    control = createDataControlModule({ db: old.db, adminUrl, secretKeyBase64: key, ledger: { ...ledger, get: async () => ({ id, projectId, kind: 'database', spec: { children: [] }, children: [] }) } });
    expect(await control.api.credentialOf(id)).toEqual({ role: 'cs_upgrade_original', password });
    expect(await old.db.execute('SELECT * FROM data_control.credentials')).toEqual(before);
    expect([...await old.db.execute('SELECT * FROM data_control.deletion_entities')]).toEqual([{ resource_id: id, project_id: projectId }]);
  } finally { await control?.observer.stop(); await old.drop(); }
});
