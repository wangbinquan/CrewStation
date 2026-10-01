import postgres from 'postgres';
import { jsonHash, precondition } from '@crewstation/kernel';
import type { Clock } from '@crewstation/kernel';
import type { DatabaseReclamationReader, OriginalPostgresDatabase, PostgresDatabaseDirectory } from '../../api/databaseReclamation';
import type { NativeDdlConnection } from '../../api/databaseRemoval';
import type { NativePostgresSource } from '../../api/storageSource';
import { NativePostgresStorageSourceSchema } from '../../api/storageSource';
import type { NativeDeletionPhysics, NativeDeletionPlan, NativeDeletionProof, NativeDeletionScope } from '../../ports/dataPlane';
import type { ProjectDeletionContext } from '@crewstation/contracts';
import { postgresServerSource, withNativePostgresNames } from './nativeNames';
import { postgresDatabaseRemoval } from './databaseRemoval';
import { postgresRoleRemoval } from './roleRemoval';

type Sql = Pick<NativeDdlConnection, 'query'>;
type ServerRow = { system_identifier: string; pg_control_version: number; catalog_version_no: number; directory: string };
type Catalog = readonly { name: string; oid: string }[];
const directoryKey = (directory: PostgresDatabaseDirectory) => JSON.stringify([directory.tablespaceOid, directory.root]);
const identity = (target: Omit<OriginalPostgresDatabase, 'identity'>) => jsonHash(target);
function validate(target: { name: string; oid: string }) {
  if (!/^cs_[a-z0-9_]{1,60}$/.test(target.name) || !/^[1-9][0-9]*$/.test(target.oid) || Number(target.oid) > 4_294_967_295) throw precondition('原数据库名字或 OID 不合法');
}
async function source(admin: Sql, endpoint: string): Promise<string> {
  return postgresServerSource((text) => admin.query<ServerRow[]>(text), endpoint);
}
async function catalog(admin: Sql, target: { name: string; oid: string }): Promise<Catalog> {
  return admin.query<{ name: string; oid: string }[]>('SELECT datname AS name,oid::text AS oid FROM pg_database WHERE datname=$1 OR oid=$2::oid ORDER BY oid', [target.name, target.oid]);
}
const matches = (rows: Catalog, target: { name: string; oid: string }) => rows.length === 1 && rows[0]?.name === target.name && rows[0].oid === target.oid;
async function directoryState(admin: Sql, path: string): Promise<boolean | null> {
  const [row] = await admin.query<{ directory: boolean | null }[]>('SELECT (pg_stat_file($1,true)).isdir AS directory', [path]);
  if (!row || (typeof row.directory !== 'boolean' && row.directory !== null)) throw precondition('原数据库文件观测不完整');
  return row.directory;
}
async function roots(admin: Sql): Promise<PostgresDatabaseDirectory[]> {
  if (await directoryState(admin, 'base') !== true) throw precondition('原 PostgreSQL base 来源不可读');
  const result: PostgresDatabaseDirectory[] = [{ tablespaceOid: null, root: 'base' }];
  const spaces = await admin.query<{ oid: string; location: string }[]>('SELECT oid::text AS oid,pg_tablespace_location(oid) AS location FROM pg_tablespace WHERE oid NOT IN (1663,1664) ORDER BY oid');
  for (const space of spaces) {
    if (!/^[1-9][0-9]*$/.test(space.oid) || !space.location.startsWith('/') || await directoryState(admin, space.location) !== true) throw precondition('原表空间位置不可读');
    const entries = await admin.query<{ entry: string }[]>('SELECT pg_ls_dir($1,false,true) AS entry ORDER BY entry', [space.location]);
    const versions = entries.map((r) => r.entry).filter((entry) => entry !== '.' && entry !== '..');
    if (!versions.length || versions.some((entry) => !/^PG_[0-9]+_[0-9]+$/.test(entry))) throw precondition('原表空间版本目录无法完整核实');
    for (const version of versions) {
      const root = `${space.location}/${version}`;
      if (await directoryState(admin, root) !== true) throw precondition('原表空间版本来源不可读');
      result.push({ tablespaceOid: space.oid, root });
    }
  }
  return result;
}
async function assertStable(admin: Sql, endpoint: string, target: { name: string; oid: string }, before: { source: string; catalog: Catalog; directories: readonly PostgresDatabaseDirectory[] }) {
  if (before.source !== await source(admin, endpoint) || jsonHash(before.catalog) !== jsonHash(await catalog(admin, target)) || jsonHash(before.directories) !== jsonHash(await roots(admin))) throw precondition('原数据库来源在观测期间变化，请重新核实');
}

/** Native read-only catalog and filesystem proof; never deletes databases, roles or tablespaces. */
export function postgresDatabaseReclamation(adminUrl: string, clock: Clock): DatabaseReclamationReader {
  const url = new URL(adminUrl), endpoint = JSON.stringify([url.protocol, url.hostname, url.port || '5432']);
  const pool = postgres(adminUrl, { max: 1, onnotice: () => undefined });
  const admin: Sql = { query: (text, parameters) => pool.unsafe(text, parameters ? [...parameters] : undefined) };
  const bind = (connection: Sql): Pick<DatabaseReclamationReader, 'capture' | 'verify'> => ({
    capture: async (target) => {
      validate(target);
      const selected = { name: target.name, oid: target.oid };
      const before = { source: await source(connection, endpoint), catalog: await catalog(connection, selected), directories: await roots(connection) };
      if (!matches(before.catalog, selected)) throw precondition('原数据库 OID 和名字无法匹配；初次 absent 不是清理证明');
      await assertStable(connection, endpoint, selected, before);
      const original = { ...selected, source: before.source, directories: before.directories };
      return { ...original, identity: identity(original) };
    },
    verify: async (original) => {
      validate(original);
      const { identity: digest, ...target } = original;
      if (digest !== identity(target) || !original.directories.length || original.directories[0]?.root !== 'base' || original.directories[0].tablespaceOid !== null) throw precondition('原数据库物理来源摘要不匹配');
      const before = { source: await source(connection, endpoint), catalog: await catalog(connection, original), directories: await roots(connection) };
      if (original.source !== before.source) throw precondition('原 PostgreSQL 服务器来源变化');
      const current = new Set(before.directories.map(directoryKey));
      if (original.directories.some((directory) => !current.has(directoryKey(directory)))) throw precondition('原表空间位置或版本来源变化');
      const observedAt = clock.now().toISOString();
      if (before.catalog.length && !matches(before.catalog, original)) return { kind: 'replaced', observedAt };
      let remainingDirectories = 0;
      for (const directory of before.directories) if (await directoryState(connection, `${directory.root}/${original.oid}`) !== null) remainingDirectories += 1;
      await assertStable(connection, endpoint, original, before);
      if (before.catalog.length || remainingDirectories) return { kind: 'present', catalogPresent: before.catalog.length > 0, remainingDirectories, observedAt };
      return { kind: 'gone', identity: original.identity, digest: jsonHash({ identity: original.identity, source: before.source, directories: before.directories, remainingDirectories: 0 }), observedAt };
    },
  });
  return { ...bind(admin), using: (connection) => bind({ query: async (text, parameters) => { await connection.assertHeld(); return connection.query(text, parameters); } }), close: async () => { await pool.end(); } };
}

const nativeCatalog = (connection: NativeDdlConnection, names: NativeDeletionPlan['names']) => connection.query<Array<{ kind: 'database' | 'role'; name: string; oid: string }>>("SELECT 'database' AS kind,datname AS name,oid::text FROM pg_database WHERE datname IN (SELECT value->>'name' FROM jsonb_array_elements($1::text::jsonb)) UNION ALL SELECT 'role' AS kind,rolname AS name,oid::text FROM pg_roles WHERE rolname IN (SELECT value->>'name' FROM jsonb_array_elements($1::text::jsonb)) ORDER BY kind,name", [JSON.stringify(names)]);
const scopeCount = (scope: NativeDeletionScope) => scope.databases.length + scope.roles.length;
async function originalSource(connection: NativeDdlConnection, source: NativePostgresSource, scope: NativeDeletionScope) {
  await connection.assertHeld();
  if (scope.storage) await source.verify(connection, scope.storage);
  const current = await nativeCatalog(connection, scope.absent);
  if (scope.absent.some((entry) => current.some((row) => row.kind === entry.kind && row.name === entry.name))) throw precondition('原确认 absent 名字出现了新原生实体，禁止接管');
  await assertNoForeignDependencies(connection, scope);
  await connection.assertHeld();
}
async function assertNoForeignDependencies(connection: NativeDdlConnection, scope: Pick<NativeDeletionScope, 'databases' | 'roles'>) {
  // pg_shdepend is cluster-wide. Only original databases and memberships wholly inside
  // the confirmed roles (plus the platform's read-only parent) belong to this scope.
  const [row] = await connection.query<{ present: boolean }[]>(`WITH roles AS (SELECT (x->>'oid')::oid AS oid FROM jsonb_array_elements($1::text::jsonb) x),
    databases AS (SELECT (x->>'oid')::oid AS oid FROM jsonb_array_elements($2::text::jsonb) x)
    SELECT EXISTS(SELECT 1 FROM pg_shdepend d WHERE refclassid='pg_authid'::regclass AND refobjid IN (SELECT oid FROM roles)
      AND NOT(dbid IN (SELECT oid FROM databases) OR (dbid=0 AND classid='pg_database'::regclass AND objid IN (SELECT oid FROM databases)) OR
        (classid='pg_auth_members'::regclass AND EXISTS(SELECT 1 FROM pg_auth_members m WHERE m.oid=d.objid AND (m.roleid IN (SELECT oid FROM roles) OR m.member IN (SELECT oid FROM roles)))))) OR
      EXISTS(SELECT 1 FROM pg_auth_members m JOIN pg_roles p ON p.oid=m.roleid
        WHERE (m.roleid IN (SELECT oid FROM roles) OR m.member IN (SELECT oid FROM roles)) AND
          NOT((m.roleid IN (SELECT oid FROM roles) AND m.member IN (SELECT oid FROM roles)) OR (m.member IN (SELECT oid FROM roles) AND p.rolname='pg_read_all_data'))) AS present`, [JSON.stringify(scope.roles), JSON.stringify(scope.databases)]);
  if (typeof row?.present !== 'boolean') throw precondition('原角色跨库和成员依赖无法完整观测');
  if (row.present) throw precondition('原角色仍被确认范围外的对象或成员引用', { code: 'native_postgres_foreign_dependency' });
}
async function actualConsumers(connection: NativeDdlConnection, scope: NativeDeletionScope, adminUrl: string) {
  const url = new URL(adminUrl); url.username = ''; url.password = ''; url.pathname = '/postgres';
  const [server] = await connection.query<{ identifier: string }[]>('SELECT system_identifier::text AS identifier FROM pg_control_system()');
  if (!server?.identifier) throw precondition('原生会话服务器来源不可读');
  const sessionSource = jsonHash({ endpoint: url.toString(), identifier: server.identifier });
  if (scope.plan.sessions.some((session) => session.sourceIdentity !== sessionSource)) throw precondition('原生 backend 原服务器来源已变化');
  const [row] = await connection.query<{ present: boolean }[]>(`SELECT
    EXISTS(SELECT 1 FROM pg_stat_activity a WHERE EXISTS(SELECT 1 FROM jsonb_array_elements($1::text::jsonb) s WHERE a.pid=(s->>'pid')::integer AND a.backend_start=(s->>'started')::timestamptz)) OR
    EXISTS(SELECT 1 FROM pg_stat_activity WHERE datid IN (SELECT (x->>'oid')::oid FROM jsonb_array_elements($2::text::jsonb) x) OR usesysid IN (SELECT (x->>'oid')::oid FROM jsonb_array_elements($3::text::jsonb) x)) OR
    EXISTS(SELECT 1 FROM pg_prepared_xacts WHERE database IN (SELECT x->>'name' FROM jsonb_array_elements($2::text::jsonb) x) OR owner IN (SELECT x->>'name' FROM jsonb_array_elements($3::text::jsonb) x)) OR
    EXISTS(SELECT 1 FROM pg_replication_slots WHERE database IN (SELECT x->>'name' FROM jsonb_array_elements($2::text::jsonb) x)) AS present`, [JSON.stringify(scope.plan.sessions), JSON.stringify(scope.databases), JSON.stringify(scope.roles)]);
  if (typeof row?.present !== 'boolean') throw precondition('实际原生消费者、预备事务或复制槽观测不完整');
  return row.present;
}
async function captureScope(connection: NativeDdlConnection, plan: NativeDeletionPlan, source: NativePostgresSource, reader: DatabaseReclamationReader, adminUrl: string): Promise<NativeDeletionScope> {
  const storage = NativePostgresStorageSourceSchema.parse(await source.capture(connection));
  for (const original of plan.sources) await source.verify(connection, original);
  if (plan.sources.some((original) => original.identity !== storage.identity)) throw precondition('原生历史对应的独立卷已经替换');
  const current = await nativeCatalog(connection, plan.names), bound = reader.using?.(connection);
  if (!bound) throw precondition('原数据库物理读取没有绑定原 native backend');
  const url = new URL(adminUrl), endpoint = JSON.stringify([url.protocol, url.hostname, url.port || '5432']);
  const server = await postgresServerSource((text) => connection.query<ServerRow[]>(text), endpoint);
  const databases: NativeDeletionScope['databases'][number][] = [], roles: NativeDeletionScope['roles'][number][] = [], absent: NativeDeletionScope['absent'][number][] = [];
  for (const expected of plan.names) {
    const actual = current.find((row) => row.kind === expected.kind && row.name === expected.name), recorded = plan.catalog.filter((fact) => fact.kind === expected.kind && fact.name === expected.name);
    if (!actual) {
      if (recorded.length) throw precondition('保留原 OID 已无当前实体；不能把历史文件默认归零');
      absent.push(expected); continue;
    }
    if (!plan.sources.length || recorded.length !== 1 || actual.oid !== recorded[0]?.oid) throw precondition('当前名字或 OID 无完整保留身份，禁止接管新实体');
    if (actual.kind === 'database') databases.push(await bound.capture(actual));
    else { const original = { name: actual.name, oid: actual.oid, source: server }; roles.push({ ...original, identity: jsonHash(original) }); }
  }
  await source.verify(connection, storage); await connection.assertHeld();
  if (jsonHash(current) !== jsonHash(await nativeCatalog(connection, plan.names))) throw precondition('原生 SQL 身份在固定范围时变化');
  await assertNoForeignDependencies(connection, { databases, roles });
  return { version: 1, plan, storage, databases, roles, absent };
}
async function absentRoles(connection: NativeDdlConnection, scope: NativeDeletionScope) {
  for (const role of scope.roles) {
    const rows = await connection.query<{ name: string; oid: string }[]>('SELECT rolname AS name,oid::text FROM pg_roles WHERE rolname=$1 OR oid=$2::oid', [role.name, role.oid]);
    if (rows.length) {
      if (rows.length !== 1 || rows[0]?.name !== role.name || rows[0].oid !== role.oid) throw precondition('原角色名字或 OID 被替换');
      return false;
    }
    const [dependencies] = await connection.query<{ present: boolean }[]>("SELECT EXISTS(SELECT 1 FROM pg_shdepend WHERE refclassid='pg_authid'::regclass AND refobjid=$1::oid) OR EXISTS(SELECT 1 FROM pg_auth_members WHERE roleid=$1::oid OR member=$1::oid) AS present", [role.oid]);
    if (dependencies?.present !== false) return false;
  }
  return true;
}
/** Complete original-backend physics for the internal owner. No orphan directory unlink or FORCE. */
export function postgresNativeDeletionPhysics(input: { adminUrl: string; source: NativePostgresSource; reader: DatabaseReclamationReader; assertGrant(context: ProjectDeletionContext): Promise<void> }): NativeDeletionPhysics {
  const held = <T>(scope: NativeDeletionScope, work: (connection: NativeDdlConnection) => Promise<T>) => {
    if (!scope.plan.names.length) return work({ query: async () => { throw precondition('空物理范围不能查询 PostgreSQL'); }, assertHeld: async () => undefined });
    return withNativePostgresNames(input.adminUrl, scope.plan.names.map((entry) => entry.name), work, { tryOnly: true });
  };
  const observe = (scope: NativeDeletionScope, gone: boolean): Promise<NativeDeletionProof> => held(scope, async (connection) => {
    if (scope.plan.names.length) {
      await originalSource(connection, input.source, scope);
      if (await actualConsumers(connection, scope, input.adminUrl)) return { kind: 'waiting', reason: '原数据库连接、原 backend、预备事务或复制槽仍在' };
      if (gone) {
        const bound = input.reader.using?.(connection); if (!bound) throw precondition('原库复核没有实际 backend');
        for (const original of scope.databases) { const proof = await bound.verify(original); if (proof.kind === 'replaced') throw precondition('原库名字或 OID 被替换'); if (proof.kind !== 'gone') return { kind: 'waiting', reason: '原数据库目录或实体尚未实际回收' }; }
        if (!await absentRoles(connection, scope)) return { kind: 'waiting', reason: '原角色或跨库依赖尚未实际归零' };
      }
      await originalSource(connection, input.source, scope);
    }
    return { kind: 'done', digest: jsonHash({ scope: physicalScopeIdentity(scope), drained: true, gone }), count: scopeCount(scope) };
  });
  return {
    capture: (plan) => plan.names.length ? withNativePostgresNames(input.adminUrl, plan.names.map((entry) => entry.name), (connection) => captureScope(connection, plan, input.source, input.reader, input.adminUrl), { tryOnly: true }) : Promise.resolve({ version: 1, plan, storage: null, databases: [], roles: [], absent: [] }),
    stop: (scope) => observe(scope, false), prove: (scope) => observe(scope, true),
    purge: async (context, scope) => {
      const stopped = await observe(scope, false); if (stopped.kind !== 'done') return stopped;
      const verify = (connection: NativeDdlConnection) => originalSource(connection, input.source, scope);
      const databases = postgresDatabaseRemoval(input.adminUrl, input.reader, input.assertGrant, verify);
      const roles = postgresRoleRemoval(input.adminUrl, input.assertGrant, verify);
      for (const original of scope.databases) { const removed = await databases.remove(context, original); if (removed.kind !== 'gone') return { kind: 'waiting', reason: '原数据库消费者或文件仍在' }; }
      for (const original of scope.roles) { const removed = await roles.remove(context, original, scope.roles); if (removed.kind !== 'gone') return { kind: 'waiting', reason: '原角色消费者或跨库依赖仍在' }; }
      return observe(scope, true);
    },
  };
}
function physicalScopeIdentity(scope: NativeDeletionScope) {
  return { keys: scope.plan.keys, storage: scope.storage?.identity ?? null, databases: scope.databases.map((entry) => entry.identity), roles: scope.roles.map((entry) => entry.identity), absent: scope.absent };
}
