import postgres from 'postgres';
import { conflict, jsonHash, precondition } from '@crewstation/kernel';
import type { DatabaseGenerationInspector } from '../../api/databaseGenerations';
import type { NativePostgresJournal, NativePostgresSource } from '../../api/storageSource';
import { withNativePostgresNames } from './nativeNames';

/** Uses catalog OIDs and independently observed storage epochs; a copied server ID alone is insufficient. */
export function postgresDatabaseGenerationInspector(adminUrl: string, journal: NativePostgresJournal, source: NativePostgresSource): DatabaseGenerationInspector {
  return { inspect: (input) => withNativePostgresNames(adminUrl, [input.databaseName], async (connection) => {
    if (!/^cs_[a-z0-9_]{1,60}$/.test(input.databaseName)) throw precondition('恢复目标数据库名不合法');
    const read = () => connection.query<{ identifier: string; database_oid: string; role_oid: string; owner_oid: string }[]>(`SELECT (SELECT system_identifier::text FROM pg_control_system()) AS identifier,d.oid::text AS database_oid,r.oid::text AS role_oid,d.datdba::text AS owner_oid FROM pg_database d JOIN pg_roles r ON r.rolname=$1 WHERE d.datname=$1`, [input.databaseName]);
    const [row] = await read(); if (!row) return null;
    if (row.owner_oid !== row.role_oid) throw conflict('恢复目标数据库的原角色身份不一致');
    const storage = await source.capture(connection);
    const endpoint = new URL(adminUrl); endpoint.username = ''; endpoint.password = ''; endpoint.pathname = '/postgres';
    const nativeSource = jsonHash({ endpoint: endpoint.toString(), identifier: row.identifier });
    const identity = { serverId: jsonHash({ source: nativeSource, storage: storage.identity }), databaseOid: row.database_oid, roleOid: row.role_oid };
    const history = await journal.read(input.projectId);
    const own = history.records.filter((entry) => entry.resourceId === input.resourceId);
    const born = own.find((entry) => entry.journalVersion === 1 && entry.state === 'finished' && entry.nativeSession?.sourceIdentity === nativeSource && entry.before && !entry.before.catalog.some((item) => item.kind === 'database' && item.name === input.databaseName) && entry.after?.storage?.identity === storage.identity && entry.after.catalog.some((item) => item.kind === 'database' && item.name === input.databaseName && item.oid === row.database_oid) && entry.after.catalog.some((item) => item.kind === 'role' && item.name === input.databaseName && item.oid === row.role_oid));
    const target = new URL(adminUrl); target.pathname = `/${input.databaseName}`;
    const client = postgres(target.toString(), { max: 1, onnotice: () => undefined });
    let empty: boolean;
    try {
      const [contents] = await client<{ empty: boolean }[]>`SELECT NOT EXISTS(SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname NOT LIKE 'pg_%' AND n.nspname<>'information_schema') AND NOT EXISTS(SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname NOT LIKE 'pg_%' AND n.nspname<>'information_schema') AND NOT EXISTS(SELECT 1 FROM pg_namespace WHERE nspname NOT LIKE 'pg_%' AND nspname NOT IN ('public','information_schema')) AND NOT EXISTS(SELECT 1 FROM pg_extension WHERE extname<>'plpgsql') AS empty`;
      empty = contents?.empty === true;
    } finally { await client.end(); }
    await connection.assertHeld(); await source.verify(connection, storage);
    const [after] = await read();
    if (!after || after.database_oid !== row.database_oid || after.role_oid !== row.role_oid || after.identifier !== row.identifier) throw conflict('读取期间数据库物理身份变化');
    return { identity, empty, provisioning: own.some(entry=>entry.state==='running'), birthDigest: born ? jsonHash({ workId: born.workId, resourceId: input.resourceId, identity, before: born.before?.catalog, after: born.after?.catalog }) : null };
  }) };
}
