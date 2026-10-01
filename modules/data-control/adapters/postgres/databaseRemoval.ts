import { ProjectDeletionContextSchema } from '@crewstation/contracts';
import type { ProjectDeletionContext } from '@crewstation/contracts';
import { jsonHash, precondition } from '@crewstation/kernel';
import type { DatabaseRemoval, NativeDdlConnection, PostgresDatabaseRemoval } from '../../api/databaseRemoval';
import type { DatabaseReclamationReader, OriginalPostgresDatabase } from '../../api/databaseReclamation';
import { withNativePostgresNames } from './nativeNames';

type CatalogRow = { name: string; oid: string; connects: boolean; comment: string | null };
const quoted = (name: string) => {
  if (!/^cs_[a-z0-9_]{1,60}$/.test(name)) throw precondition('原生数据库名字不合法');
  return '"' + name + '"';
};
const quarantineName = (context: ProjectDeletionContext, original: OriginalPostgresDatabase) =>
  'cs_deleting_' + jsonHash({ projectId: context.target.id, operationId: context.operationId, identity: original.identity }).slice(0, 40);
const marker = (context: ProjectDeletionContext, original: OriginalPostgresDatabase) =>
  JSON.stringify({ kind: 'crewstation-original-database-removal/v1', projectId: context.target.id, operationId: context.operationId, identity: original.identity });
async function catalog(connection: NativeDdlConnection, original: OriginalPostgresDatabase, quarantine: string) {
  return connection.query<CatalogRow[]>("SELECT datname AS name,oid::text AS oid,datallowconn AS connects,shobj_description(oid,'pg_database') AS comment FROM pg_database WHERE datname=$1 OR datname=$2 OR oid=$3::oid ORDER BY oid", [original.name, quarantine, original.oid]);
}
function checkedRow(rows: readonly CatalogRow[], original: OriginalPostgresDatabase, quarantine: string, expectedMarker: string) {
  if (!rows.length) return undefined;
  const row = rows[0]!;
  if (rows.length !== 1 || row.oid !== original.oid || ![original.name, quarantine].includes(row.name)) throw precondition('原数据库名字或 OID 已替换，不能接管新库');
  if (row.name === quarantine && (row.comment !== expectedMarker || row.connects)) throw precondition('隔离数据库的原操作标记或连接屏障不匹配');
  return row;
}
async function consumers(connection: NativeDdlConnection, row: CatalogRow) {
  const [result] = await connection.query<{ present: boolean }[]>(
    'SELECT EXISTS(SELECT 1 FROM pg_stat_activity WHERE datid=$1::oid) OR EXISTS(SELECT 1 FROM pg_prepared_xacts WHERE database=$2) OR EXISTS(SELECT 1 FROM pg_replication_slots WHERE database=$2) AS present', [row.oid, row.name]);
  if (!result || typeof result.present !== 'boolean') throw precondition('原数据库消费者观测不完整');
  return result.present;
}
async function sourceMatches(reader: DatabaseReclamationReader, original: OriginalPostgresDatabase, row: CatalogRow) {
  const captured = await reader.capture({ name: row.name, oid: row.oid });
  if (captured.source !== original.source || original.directories.some((directory) => !captured.directories.some((current) => jsonHash(current) === jsonHash(directory)))) throw precondition('原数据库物理来源已变化');
}
async function quarantine(connection: NativeDdlConnection, context: ProjectDeletionContext, original: OriginalPostgresDatabase, reader: DatabaseReclamationReader, grant: () => Promise<void>) {
  const name = quarantineName(context, original), expectedMarker = marker(context, original);
  await connection.query('BEGIN');
  try {
    await connection.query('LOCK TABLE pg_catalog.pg_database IN SHARE ROW EXCLUSIVE MODE');
    await grant(); await connection.assertHeld();
    const row = checkedRow(await catalog(connection, original, name), original, name, expectedMarker);
    if (row) {
      await sourceMatches(reader, original, row);
      if (await consumers(connection, row)) { await connection.query('ROLLBACK'); return { waiting: true, name }; }
      if (row.name === original.name) {
        await connection.query('ALTER DATABASE ' + quoted(original.name) + ' WITH ALLOW_CONNECTIONS false');
        await connection.query('ALTER DATABASE ' + quoted(original.name) + ' RENAME TO ' + quoted(name));
        await connection.query('COMMENT ON DATABASE ' + quoted(name) + " IS '" + expectedMarker.replaceAll("'", "''") + "'");
      }
    }
    await connection.query('COMMIT');
    return { waiting: false, name };
  } catch (error) {
    try { await connection.query('ROLLBACK'); } catch { /* Original native connection may have stopped. */ }
    throw error;
  }
}
function checkedContext(raw: ProjectDeletionContext, original: OriginalPostgresDatabase) {
  const context = ProjectDeletionContextSchema.parse(raw);
  const resource = context.confirmed.resources.find((r) => r.kind === 'postgres-database' && r.id === original.name);
  if (context.phase !== 'purge' || context.confirmed.participant !== 'data-control' || !context.confirmed.complete || context.confirmed.blockers.length || context.confirmed.references.length ||
    !resource || resource.count !== 1 || resource.scope !== 'physical' || resource.identity !== original.identity || resource.sourceIdentity !== original.identity) throw precondition('原数据库不属于已确认的 data-control/purge 许可');
  return context;
}

/** No HTTP entry or complete deletion owner is registered by this primitive. Normal DROP, never FORCE. */
export function postgresDatabaseRemoval(adminUrl: string, reader: DatabaseReclamationReader, assertGrant: (context: ProjectDeletionContext) => Promise<void>): DatabaseRemoval {
  return { remove: async (raw, original): Promise<PostgresDatabaseRemoval> => {
    const context = checkedContext(raw, original), grant = () => assertGrant(context);
    await grant();
    return withNativePostgresNames(adminUrl, [original.name, quarantineName(context, original)], async (connection) => {
      await grant();
      const proof = await reader.verify(original);
      if (proof.kind === 'gone') { await grant(); return { kind: 'gone', proof }; }
      const prepared = await quarantine(connection, context, original, reader, grant);
      if (prepared.waiting) return { kind: 'waiting', reason: 'native-consumers' };
      const row = checkedRow(await catalog(connection, original, prepared.name), original, prepared.name, marker(context, original));
      if (row) {
        if (row.name !== prepared.name) throw precondition('原数据库没有完成本操作隔离');
        await sourceMatches(reader, original, row);
        await grant(); await connection.assertHeld();
        await connection.query('DROP DATABASE ' + quoted(prepared.name));
      }
      const final = await reader.verify(original);
      await grant();
      if (final.kind === 'replaced') throw precondition('原数据库名字或 OID 已替换，不能把新库当作清理完成');
      return final.kind === 'gone' ? { kind: 'gone', proof: final } : { kind: 'waiting', reason: 'original-files' };
    });
  } };
}
