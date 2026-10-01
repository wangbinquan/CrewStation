import { afterEach, describe, expect, test } from 'bun:test';
import type { ProjectId } from '@crewstation/contracts';
import { precondition } from '@crewstation/kernel';
import type { Database } from '@crewstation/persistence';
import { withSharedDatabaseAdmission } from '@crewstation/persistence';
import { generateSecretKey } from '@crewstation/secretbox';
import type { TestDatabase } from '@crewstation/testkit';
import { createTestDatabase, testDatabaseAvailable } from '@crewstation/testkit';
import { sql } from 'drizzle-orm';
import { secretboxCipher } from '../adapters/crypto/secretboxCipher';
import { drizzleNativePostgresHistory } from '../adapters/persistence/drizzleRepositories';
import { nativePostgresHistoryUseCases } from '../application/serviceData';
import { createDataModule, dataMigrations } from '../wiring';

const available = await testDatabaseAvailable();
const PROJECT = '01a0fa00-0000-7000-8000-000000000001' as ProjectId;
const OTHER = '01a0fa00-0000-7000-8000-000000000002' as ProjectId;
const KEY = generateSecretKey(), cipher = secretboxCipher(KEY);
const PASSWORD = 'history-password-DO-NOT-EXPOSE';
const DSN = `postgres://legacy_role:${PASSWORD}@original.example:5543/legacy_database`;
let database: TestDatabase | undefined;

async function fixture() {
  const db = await createTestDatabase([dataMigrations]); database = db;
  const module = (connection: Database = db.db) => createDataModule({
    db: connection, authorizer: { authorize: async () => { throw precondition('closed'); }, assertProjectAvailable: async () => { throw precondition('deleting'); } },
    services: { resolveServiceById: async () => { throw new Error('must not resolve or recreate a service'); } }, isAdmin: async () => false,
    credentials: { credentialOf: async () => { throw new Error('must not reissue credentials'); } },
    settings: { defaultPlan: 'basic', secretKeyBase64: KEY, postgres: { adminUrl: db.url, visibleHost: 'unused', visiblePort: 5432 } },
    provider: { provisionDatabase: async () => { throw new Error('must not provision'); }, createTemporaryRole: async () => { throw new Error('must not create a role'); }, dropRole: async () => { throw new Error('must not drop a role'); }, dropDatabase: async () => { throw new Error('must not drop a database'); } },
  });
  return { db, module };
}
async function resource(db: Database, input: { id?: string; projectId?: ProjectId; state?: string; box?: string | null; name?: string; kind?: string; env?: string } = {}) {
  const id = input.id ?? Bun.randomUUIDv7();
  await db.execute(sql`INSERT INTO data.resources(id,project_id,service_id,kind,env,plan,state,env_var,object_name,secret_box,created_at,updated_at)
    VALUES (${id},${input.projectId ?? PROJECT},${id},${input.kind ?? 'postgres'},${input.env ?? 'production'},'basic',${input.state ?? 'ready'},'CS_DATABASE_URL',${input.name ?? 'legacy_database'},${input.box === undefined ? await cipher.encrypt(DSN) : input.box},now(),now())`);
  return id;
}
async function binding(db: Database, input: { id?: string; projectId?: ProjectId; state?: string; mode?: string; role?: string | null; box?: string | null; legacyId?: string | null } = {}) {
  const id = input.id ?? Bun.randomUUIDv7();
  await db.execute(sql`INSERT INTO data.task_bindings(id,project_id,service_id,task_id,legacy_resource_id,mode,state,requested_by,ttl_minutes,role_name,secret_box,expires_at,created_at,updated_at)
    VALUES (${id},${input.projectId ?? PROJECT},${id},${id},${input.legacyId ?? null},${input.mode ?? 'diagnostic-readonly'},${input.state ?? 'expired'},${PROJECT},30,${input.role === undefined ? 'legacy_role' : input.role},${input.box === undefined ? await cipher.encrypt(DSN) : input.box},now()-interval '1 day',now(),now())`);
  return id;
}

describe.skipIf(!available)('data retained native PostgreSQL history', () => {
  afterEach(async () => { await database?.drop(); database = undefined; });

  test('公开内部端口在项目闭准入后仍读取所有状态的原资源、旧临时角色与别名，且不续发口令或泄露秘密', async () => {
    const { db, module } = await fixture();
    for (const state of ['requested', 'provisioning', 'ready', 'failed', 'releasing', 'released']) await resource(db.db, { state });
    for (const state of ['requested', 'approved', 'rejected', 'active', 'expired', 'revoked']) await binding(db.db, { state, legacyId: 'original-binding-alias' });
    await resource(db.db, { projectId: OTHER }); await binding(db.db, { projectId: OTHER });
    const history = await module().api.nativePostgresHistory!.read(PROJECT);
    expect(history.projectId).toBe(PROJECT); expect(history.retainedRecordsComplete).toBe(true);
    expect(history.resources).toHaveLength(6); expect(history.bindings).toHaveLength(6); expect(history.gaps).toEqual([]);
    expect(history.resources[0]?.dsn).toMatchObject({ state: 'available', origin: { hostname: 'original.example', port: 5543, database: 'legacy_database', role: 'legacy_role' } });
    expect(history.bindings.every((row) => row.legacyResourceId === 'original-binding-alias' && row.roleName === 'legacy_role')).toBe(true);
    expect(history.bindings.every((row) => row.expiresAt !== null)).toBe(true);
    const serialized = JSON.stringify(history);
    expect(serialized).not.toContain(PASSWORD); expect(serialized).not.toContain(DSN); expect(serialized).not.toContain('secretBox');
    expect(history.resources[0]?.dsn.ciphertextDigest).toMatch(/^[a-f0-9]{64}$/);
  });

  test('新供给缺少连接串和 development 哨兵只是保留事实，其他对象不是 PostgreSQL 角色或来源', async () => {
    const { db, module } = await fixture();
    const modern = await resource(db.db, { box: null });
    const shared = await binding(db.db, { mode: 'development', role: 'development' });
    const pending = await binding(db.db, { state: 'requested', role: null, box: null });
    const other = await resource(db.db, { kind: 's3', box: 'not-a-postgres-dsn', name: 'original-bucket' });
    const history = await module().api.nativePostgresHistory!.read(PROJECT);
    expect(history.resources.find((row) => row.id === modern)?.dsn).toEqual({ state: 'absent', origin: null, ciphertextDigest: null });
    expect(history.bindings.find((row) => row.id === shared)?.roleName).toBe('development');
    expect(history.bindings.find((row) => row.id === pending)?.dsn.state).toBe('absent');
    expect(history.resources.find((row) => row.id === other)?.dsn.state).toBe('not-applicable');
    expect(history.gaps).toEqual([]);
  });

  test('1001 个资源与 1001 个历史绑定全部读尽，摘要固定原项目且密码密文变化能使摘要失效', async () => {
    const { db, module } = await fixture();
    const seed = await resource(db.db, { box: null }), bind = await binding(db.db, { box: null });
    await db.db.execute(sql`INSERT INTO data.resources(id,project_id,service_id,kind,env,plan,state,env_var,object_name,secret_box,message,created_at,updated_at) SELECT left(${seed},24)||lpad(n::text,12,'0'),project_id,left(${seed},24)||lpad(n::text,12,'0'),kind,env,plan,state,env_var,object_name,secret_box,message,created_at,updated_at FROM data.resources CROSS JOIN generate_series(1,1000) AS n WHERE id=${seed}`);
    await db.db.execute(sql`INSERT INTO data.task_bindings(legacy_resource_id,id,task_id,service_id,project_id,mode,state,reason,decision,requested_by,decided_by,ttl_minutes,expires_at,role_name,secret_box,created_at,updated_at) SELECT legacy_resource_id,left(${bind},24)||lpad(n::text,12,'0'),task_id,service_id,project_id,mode,state,reason,decision,requested_by,decided_by,ttl_minutes,expires_at,role_name,secret_box,created_at,updated_at FROM data.task_bindings CROSS JOIN generate_series(1,1000) AS n WHERE id=${bind}`);
    const reader = module().api.nativePostgresHistory!;
    const before = await reader.read(PROJECT);
    expect(before.resources).toHaveLength(1001); expect(before.bindings).toHaveLength(1001);
    expect(new Set(before.resources.map((row) => row.id)).size).toBe(1001);
    expect(new Set(before.bindings.map((row) => row.id)).size).toBe(1001);
    expect(await reader.read(PROJECT)).toEqual(before);
    await db.db.execute(sql`UPDATE data.resources SET secret_box=${await cipher.encrypt(DSN)} WHERE id=${seed}`);
    expect((await reader.read(PROJECT)).revision).not.toBe(before.revision);
    expect((await reader.read(OTHER)).revision).not.toBe((await reader.read('01a0fa00-0000-7000-8000-000000000003' as ProjectId)).revision);
  });

  test('跨页和两张表共享真实只读快照，交错独立提交只出现在下一轮；真实 shared 上下文可读', async () => {
    const { db, module } = await fixture();
    const seed = await resource(db.db, { box: null }); await binding(db.db, { box: null });
    await db.db.execute(sql`INSERT INTO data.resources(id,project_id,service_id,kind,env,plan,state,env_var,object_name,secret_box,message,created_at,updated_at) SELECT left(${seed},24)||lpad(n::text,12,'0'),project_id,left(${seed},24)||lpad(n::text,12,'0'),kind,env,plan,state,env_var,object_name,secret_box,message,created_at,updated_at FROM data.resources CROSS JOIN generate_series(1,500) AS n WHERE id=${seed}`);
    const before = await module().api.nativePostgresHistory!.read(PROJECT);
    let changed = false;
    let originalConfig: { isolation: unknown; readonly: unknown } | undefined;
    const interleaved = new Proxy(db.db, { get(target, field, receiver) {
      if (field !== 'transaction') return Reflect.get(target, field, receiver);
      return (work: Parameters<Database['transaction']>[0], config?: Parameters<Database['transaction']>[1]) => target.transaction(async (tx) => work(new Proxy(tx, { get(current, key, currentReceiver) {
        if (key !== 'execute') return Reflect.get(current, key, currentReceiver);
        return async (...args: Parameters<typeof current.execute>) => {
          const rows = await current.execute(...args);
          if (!changed && rows.some((row) => row['kind'] === 'postgres')) {
            changed = true;
            originalConfig = (await current.execute(sql`SELECT current_setting('transaction_isolation') AS isolation,current_setting('transaction_read_only') AS readonly`))[0] as typeof originalConfig;
            await db.db.execute(sql`UPDATE data.resources SET object_name='replacement_name' WHERE id=${seed}`);
            await binding(db.db, { id: Bun.randomUUIDv7(), role: 'late_role', box: null });
          }
          return rows;
        };
      } })), config);
    } });
    expect(await module(interleaved).api.nativePostgresHistory!.read(PROJECT)).toEqual(before); expect(changed).toBe(true);
    expect(originalConfig).toEqual({ isolation: 'repeatable read', readonly: 'on' });
    const after = await module().api.nativePostgresHistory!.read(PROJECT);
    expect(after.bindings).toHaveLength(2); expect(after.resources.find((row) => row.id === seed)?.objectName).toBe('replacement_name');
    expect(after.revision).not.toBe(before.revision);
    expect(await withSharedDatabaseAdmission(db.db, 'data-control.project-admission:' + PROJECT, () => module().api.nativePostgresHistory!.read(PROJECT))).toEqual(after);
  });

  test('不可读、歧义与名字冲突逐项保留阻塞，不打印驱动异常或密文；无效旧状态不会丢行', async () => {
    const { db, module } = await fixture();
    const unreadable = await resource(db.db, { box: 'broken-ciphertext-sensitive' });
    const conflict = await resource(db.db, { name: 'different_database' });
    const wrongRole = await binding(db.db, { role: 'different_role' });
    const invalid = await resource(db.db, { name: '', kind: 'postgres', state: 'unknown', env: 'unknown' });
    const sentinel = await binding(db.db, { role: 'development' });
    const unknown = await resource(db.db, { kind: 'unknown', box: null });
    const history = await module().api.nativePostgresHistory!.read(PROJECT);
    expect(history.resources).toHaveLength(4); expect(history.bindings).toHaveLength(2);
    for (const [id, code] of [[unreadable, 'legacy-dsn-unreadable'], [conflict, 'legacy-dsn-conflict'], [wrongRole, 'legacy-dsn-conflict'], [invalid, 'legacy-row-invalid'], [invalid, 'legacy-name-invalid'], [sentinel, 'legacy-name-invalid'], [unknown, 'legacy-row-invalid']]) expect(history.gaps).toContainEqual(expect.objectContaining({ id, code }));
    expect(JSON.stringify(history)).not.toContain('broken-ciphertext-sensitive'); expect(JSON.stringify(history)).not.toContain(PASSWORD);
    const leakingCipher = { encrypt: cipher.encrypt, decrypt: async () => { throw new Error(DSN + ' raw-provider-error'); } };
    const rejected = await nativePostgresHistoryUseCases(drizzleNativePostgresHistory(db.db), leakingCipher).read(PROJECT);
    expect(rejected.resources[0]?.dsn.state).toBe('unreadable'); expect(JSON.stringify(rejected)).not.toContain('raw-provider-error');
  });

  test('连接串选项、多主机、默认身份、坏转义与非 PostgreSQL 地址拒绝推测来源', async () => {
    const { db, module } = await fixture();
    const values = ['postgres://role:password@host/db?host=other', 'postgres://role:password@host,other/db', 'postgres://role:password@%2Ftmp/db', 'postgres://role:password@host/', 'postgres://host/db', 'postgres://role:password@host/db#fragment', 'https://role:password@host/db', 'postgres://role:password@host/%QQ', 'postgres://role:password@host/%00', 'postgres://role:password@host:0/db'];
    for (const plain of values) await resource(db.db, { box: await cipher.encrypt(plain) });
    const history = await module().api.nativePostgresHistory!.read(PROJECT);
    expect(history.resources).toHaveLength(values.length);
    expect(history.resources.every((row) => row.dsn.state === 'invalid' && row.dsn.origin === null)).toBe(true);
    expect(history.gaps.filter((gap) => gap.code === 'legacy-dsn-invalid')).toHaveLength(values.length);
  });

  test('解码原名字与默认端口，保持 URI 原路径而不把点路径归一成另一个库', async () => {
    const { db, module } = await fixture();
    const encoded = await resource(db.db, { name: '原数据库', box: await cipher.encrypt('postgresql://original%20role:secret@host/%E5%8E%9F%E6%95%B0%E6%8D%AE%E5%BA%93') });
    const dotPath = await resource(db.db, { name: 'a/../db', box: await cipher.encrypt('postgres://role:secret@host/a/../db') });
    const history = await module().api.nativePostgresHistory!.read(PROJECT);
    expect(history.resources.find((row) => row.id === encoded)?.dsn.origin).toEqual({ hostname: 'host', port: 5432, database: '原数据库', role: 'original role' });
    expect(history.resources.find((row) => row.id === dotPath)?.dsn.origin?.database).toBe('a/../db');
    expect(history.gaps).toEqual([]);
  });

  test('数据库读取失败和非法原记录拒绝完整读取，不返回空范围或消失证明', async () => {
    const { db, module } = await fixture();
    await resource(db.db, { id: '', box: null });
    await expect(module().api.nativePostgresHistory!.read(PROJECT)).rejects.toThrow('原归属或时间格式');
    await db.db.execute(sql`DELETE FROM data.resources WHERE id=''`);
    await db.handle.close();
    await expect(module().api.nativePostgresHistory!.read(PROJECT)).rejects.toBeDefined();
  });

  test('旧角色长度按 UTF8 字节核验；未知模式和有效期仍有明确缺口或拒绝', async () => {
    const { db, module } = await fixture();
    const id = await binding(db.db, { role: '原'.repeat(22), box: null, mode: 'unknown', state: 'unknown' });
    const history = await module().api.nativePostgresHistory!.read(PROJECT);
    expect(history.gaps).toContainEqual(expect.objectContaining({ id, code: 'legacy-name-invalid' }));
    expect(history.gaps).toContainEqual(expect.objectContaining({ id, code: 'legacy-row-invalid' }));
    await db.db.execute(sql`UPDATE data.task_bindings SET expires_at=null WHERE id=${id}`);
    expect((await module().api.nativePostgresHistory!.read(PROJECT)).bindings[0]?.expiresAt).toBeNull();
    await db.db.execute(sql`UPDATE data.task_bindings SET expires_at='infinity' WHERE id=${id}`);
    await expect(module().api.nativePostgresHistory!.read(PROJECT)).rejects.toThrow('有效期格式');
    await db.db.execute(sql`UPDATE data.task_bindings SET expires_at=null,created_at='infinity' WHERE id=${id}`);
    await expect(module().api.nativePostgresHistory!.read(PROJECT)).rejects.toThrow('原归属或时间格式');
  });
});
