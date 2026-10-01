import postgres from 'postgres';
import { jsonHash, precondition } from '@crewstation/kernel';
import type { Clock } from '@crewstation/kernel';
import type { DatabaseReclamationReader, OriginalPostgresDatabase, PostgresDatabaseDirectory } from '../../api/databaseReclamation';

type Sql = ReturnType<typeof postgres>;
type Catalog = readonly { name: string; oid: string }[];
const directoryKey = (directory: PostgresDatabaseDirectory) => JSON.stringify([directory.tablespaceOid, directory.root]);
const identity = (target: Omit<OriginalPostgresDatabase, 'identity'>) => jsonHash(target);
function validate(target: { name: string; oid: string }) {
  if (!/^cs_[a-z0-9_]{1,60}$/.test(target.name) || !/^[1-9][0-9]*$/.test(target.oid) || Number(target.oid) > 4_294_967_295) throw precondition('原数据库名字或 OID 不合法');
}
async function source(admin: Sql, endpoint: string): Promise<string> {
  return postgresServerSource((text) => admin.unsafe(text), endpoint);
}
/** Shared native source fingerprint for database directories and original roles. */
export async function postgresServerSource(query: (text: string) => PromiseLike<readonly { system_identifier: string; pg_control_version: number; catalog_version_no: number; directory: string }[]>, endpoint: string): Promise<string> {
  const [row] = await query("SELECT system_identifier::text,pg_control_version,catalog_version_no,current_setting('data_directory') AS directory FROM pg_control_system()");
  if (!row || !/^[0-9]+$/.test(row.system_identifier) || !row.directory || !Number.isInteger(row.pg_control_version) || !Number.isInteger(row.catalog_version_no)) throw precondition('原 PostgreSQL 服务器来源不完整');
  return jsonHash({ endpoint, ...row });
}
async function catalog(admin: Sql, target: { name: string; oid: string }): Promise<Catalog> {
  return admin<{ name: string; oid: string }[]>`SELECT datname AS name,oid::text AS oid FROM pg_database WHERE datname=${target.name} OR oid=${target.oid}::oid ORDER BY oid`;
}
const matches = (rows: Catalog, target: { name: string; oid: string }) => rows.length === 1 && rows[0]?.name === target.name && rows[0].oid === target.oid;
async function directoryState(admin: Sql, path: string): Promise<boolean | null> {
  const [row] = await admin<{ directory: boolean | null }[]>`SELECT (pg_stat_file(${path},true)).isdir AS directory`;
  if (!row || (typeof row.directory !== 'boolean' && row.directory !== null)) throw precondition('原数据库文件观测不完整');
  return row.directory;
}
async function roots(admin: Sql): Promise<PostgresDatabaseDirectory[]> {
  if (await directoryState(admin, 'base') !== true) throw precondition('原 PostgreSQL base 来源不可读');
  const result: PostgresDatabaseDirectory[] = [{ tablespaceOid: null, root: 'base' }];
  const spaces = await admin<{ oid: string; location: string }[]>`SELECT oid::text AS oid,pg_tablespace_location(oid) AS location FROM pg_tablespace WHERE oid NOT IN (1663,1664) ORDER BY oid`;
  for (const space of spaces) {
    if (!/^[1-9][0-9]*$/.test(space.oid) || !space.location.startsWith('/') || await directoryState(admin, space.location) !== true) throw precondition('原表空间位置不可读');
    const entries = await admin<{ entry: string }[]>`SELECT pg_ls_dir(${space.location},false,true) AS entry ORDER BY entry`;
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
  const admin = postgres(adminUrl, { max: 1, onnotice: () => undefined });
  return {
    capture: async (target) => {
      validate(target);
      const before = { source: await source(admin, endpoint), catalog: await catalog(admin, target), directories: await roots(admin) };
      if (!matches(before.catalog, target)) throw precondition('原数据库 OID 和名字无法匹配；初次 absent 不是清理证明');
      await assertStable(admin, endpoint, target, before);
      const original = { ...target, source: before.source, directories: before.directories };
      return { ...original, identity: identity(original) };
    },
    verify: async (original) => {
      validate(original);
      const { identity: digest, ...target } = original;
      if (digest !== identity(target) || !original.directories.length || original.directories[0]?.root !== 'base' || original.directories[0].tablespaceOid !== null) throw precondition('原数据库物理来源摘要不匹配');
      const before = { source: await source(admin, endpoint), catalog: await catalog(admin, original), directories: await roots(admin) };
      if (original.source !== before.source) throw precondition('原 PostgreSQL 服务器来源变化');
      const current = new Set(before.directories.map(directoryKey));
      if (original.directories.some((directory) => !current.has(directoryKey(directory)))) throw precondition('原表空间位置或版本来源变化');
      const observedAt = clock.now().toISOString();
      if (before.catalog.length && !matches(before.catalog, original)) return { kind: 'replaced', observedAt };
      let remainingDirectories = 0;
      for (const directory of before.directories) if (await directoryState(admin, `${directory.root}/${original.oid}`) !== null) remainingDirectories += 1;
      await assertStable(admin, endpoint, original, before);
      if (before.catalog.length || remainingDirectories) return { kind: 'present', catalogPresent: before.catalog.length > 0, remainingDirectories, observedAt };
      return { kind: 'gone', identity: original.identity, digest: jsonHash({ identity: original.identity, source: before.source, directories: before.directories, remainingDirectories: 0 }), observedAt };
    },
    close: async () => { await admin.end(); },
  };
}
