import type { ProjectId } from '@crewstation/contracts';
import { conflict, isPlatformError, jsonHash, newResourceId, precondition } from '@crewstation/kernel';
import type { Database, Executor, Transaction } from '@crewstation/persistence';
import { assertSharedDatabaseAdmissionActive, withSharedDatabaseAdmission } from '@crewstation/persistence';
import { sql } from 'drizzle-orm';
import { z } from 'zod';
import type { NativeDdlConnection, NativePostgresOrigin, NativePostgresProcess, NativePostgresProcesses, NativePostgresWork } from '../../api/databaseRemoval';
import type { NativePostgresCatalogIdentity, NativePostgresJournalRecord, NativePostgresSource, NativePostgresStorageSource } from '../../api/storageSource';
import { withNativePostgresNames } from '../postgres/nativeNames';

export const nativeAdmissionKey = (id: string) => 'data-control.project-admission:' + id;
async function open(db: Executor, projectId: ProjectId, available?: (id: ProjectId) => Promise<void>) {
  const [row] = await db.execute<{ operation_id: string | null }>(sql`SELECT operation_id FROM data_control.deletion_fences WHERE project_id=${projectId}`);
  if (row?.operation_id) throw precondition('项目数据库正在永久清理，不能建库、授予访问、续发口令或轮换');
  await available?.(projectId);
}
export async function markNativeCredentialTransaction(transaction: Executor, guard: Executor) {
  const [row] = await guard.execute<{ pid: number }>(sql`SELECT pg_backend_pid() AS pid`);
  if (!row) throw precondition('数据库口令准入来源缺失');
  await transaction.execute(sql`SELECT set_config('crewstation.data_control_admission_pid',${String(row.pid)},true)`);
}

/** Durable original callback facts survive loss of the main admission connection. */
export function nativePostgresWork(input: { db: Database; adminUrl: string; available?: (id: ProjectId) => Promise<void>; processes?: NativePostgresProcesses; source?: NativePostgresSource }) {
  const { db } = input;
  const withResource = async <T>(origin: NativePostgresOrigin, work: (guard: Transaction) => Promise<T>): Promise<T> => {
    if (!origin?.projectId || !origin.resourceId) throw precondition('原数据库写入缺少项目和资源身份');
    return withSharedDatabaseAdmission(db, nativeAdmissionKey(origin.projectId), async (guard) => {
      await open(guard, origin.projectId, input.available);
      await db.transaction(async (tx) => {
        await tx.execute(sql`INSERT INTO data_control.deletion_entities(resource_id,project_id) VALUES (${origin.resourceId},${origin.projectId}) ON CONFLICT DO NOTHING`);
        const [owner] = await tx.execute<{ project_id: ProjectId }>(sql`SELECT project_id FROM data_control.deletion_entities WHERE resource_id=${origin.resourceId}`);
        if (owner?.project_id !== origin.projectId) throw precondition('原数据库资源不能转归其他项目');
      });
      return work(guard);
    });
  };
  const native: NativePostgresWork = { run: (origin, names, effect) => withResource(origin, async (guard) => {
    if (!names.length || names.some((name) => !/^cs_[a-z0-9_]{1,60}$/.test(name))) throw precondition('原生数据库名字锁不合法');
    const process = await input.processes?.protectCurrent(), workId = newResourceId();
    if (process && (!process.podUid || !process.containerId || !process.nodeUid || !process.nodeName)) throw precondition('原数据库写入容器来源不完整');
    const [backend] = await guard.execute<{ pid: number }>(sql`SELECT pg_backend_pid() AS pid`);
    await db.transaction((tx) => tx.execute(sql`INSERT INTO data_control.deletion_work(work_id,resource_id,project_id,backend_pid,names,pod_uid,container_id,node_uid,node_name,journal_version)
      VALUES (${workId},${origin.resourceId},${origin.projectId},${backend!.pid},${JSON.stringify([...new Set(names)].sort())}::jsonb,${process?.podUid ?? null},${process?.containerId ?? null},${process?.nodeUid ?? null},${process?.nodeName ?? null},1)`));
    try {
      // The native scope is INSIDE the actual callback. A rejected main transaction cannot release it early.
      return await withNativePostgresNames(input.adminUrl, names, async (connection) => {
        const admitted = async () => { assertSharedDatabaseAdmissionActive(db, nativeAdmissionKey(origin.projectId)); await open(guard, origin.projectId, input.available); };
        await admitted();
        const [binding] = await connection.query<{ pid: number; started: string; identifier: string }[]>("SELECT pg_backend_pid() AS pid,(SELECT backend_start::text FROM pg_stat_activity WHERE pid=pg_backend_pid()) AS started,(SELECT system_identifier::text FROM pg_control_system()) AS identifier");
        if (!binding?.started || !binding.identifier) throw precondition('原生数据库写入来源不完整');
        const endpoint = new URL(input.adminUrl); endpoint.username = ''; endpoint.password = ''; endpoint.pathname = '/postgres';
        await db.transaction((tx) => tx.execute(sql`UPDATE data_control.deletion_work SET native_pid=${binding.pid},native_started=${binding.started},source_identity=${jsonHash({ endpoint: endpoint.toString(), identifier: binding.identifier })} WHERE work_id=${workId} AND state='running'`));
        const checked: NativeDdlConnection = { assertHeld: async () => { await admitted(); await connection.assertHeld(); }, query: async (text, parameters) => {
          await admitted(); await connection.assertHeld(); return connection.query(text, parameters);
        } };
        const observation: NativeDdlConnection = { assertHeld: async () => {
          assertSharedDatabaseAdmissionActive(db, nativeAdmissionKey(origin.projectId));
          await guard.execute(sql`SELECT 1`); await connection.assertHeld();
        }, query: async (text, parameters) => { await observation.assertHeld(); return connection.query(text, parameters); } };
        return journaledEffect(db, workId, names, checked, observation, input.source, effect);
      });
    } finally {
      await db.transaction(async (tx) => {
        await tx.execute(sql`SELECT set_config('crewstation.data_control_work_exit',${workId},true)`);
        await tx.execute(sql`UPDATE data_control.deletion_work SET state='finished' WHERE work_id=${workId} AND state='running'`);
      });
    }
  }) };
  const recover = (process: NativePostgresProcess, digest: string) => db.transaction(async (tx) => {
    if (!process.podUid || !process.containerId || !process.nodeUid || !process.nodeName || !/^[a-f0-9]{64}$/.test(digest)) throw precondition('原数据库写入容器停止证明不完整');
    const rows = await tx.execute<{ work_id: string }>(sql`SELECT work_id FROM data_control.deletion_work WHERE state='running' AND pod_uid=${process.podUid} AND container_id=${process.containerId} AND node_uid=${process.nodeUid} AND node_name=${process.nodeName} ORDER BY work_id FOR UPDATE`);
    for (const row of rows) {
      await tx.execute(sql`SELECT set_config('crewstation.data_control_work_exit',${row.work_id},true)`);
      await tx.execute(sql`UPDATE data_control.deletion_work SET state='finished',proof_digest=${digest} WHERE work_id=${row.work_id}`);
    }
  });
  const originOf = async (id: string): Promise<NativePostgresOrigin | undefined> => {
    const [row] = await db.execute<{ project_id: ProjectId }>(sql`SELECT project_id FROM data_control.deletion_entities WHERE resource_id=${id}`);
    return row ? { projectId: row.project_id, resourceId: id } : undefined;
  };
  return { native, withResource, recover, originOf, journal: { read: (projectId: ProjectId) => readJournal(db, projectId) }, sweep: () => input.processes?.sweep({ stopped: recover, releasable: async (uid) => {
    const [row] = await db.execute<{ pending: boolean }>(sql`SELECT EXISTS(SELECT 1 FROM data_control.deletion_work WHERE pod_uid=${uid} AND state='running') AS pending`);
    return row?.pending === false;
  } }) ?? Promise.resolve() };
}

type CatalogIdentity = NativePostgresCatalogIdentity;
const hash = z.string().regex(/^[a-f0-9]{64}$/), identity = z.string().min(1), absolute = z.string().refine((path) => path.startsWith('/') && !path.split('/').includes('..'));
const volumeSchema = z.object({ pvcUid: identity, pvUid: identity, nodeUid: identity, mountPath: absolute, providerPath: absolute, rootEpoch: hash, volumeEpoch: hash, entries: z.array(z.object({ key: identity, relativePath: identity.refine((path) => !path.startsWith('/') && !path.split('/').includes('..')), kind: z.enum(['file', 'directory']), identity: hash })).min(1) });
const storageSchema = z.object({ identity: hash, serviceUid: identity, server: z.object({ podUid: identity, containerId: identity, nodeUid: identity, address: identity }), volumes: z.array(volumeSchema).min(1), observedAt: z.iso.datetime() }).refine((source) => {
  const entries = source.volumes.flatMap((volume) => volume.entries);
  return new Set(entries.map((entry) => entry.key)).size === entries.length && entries.some((entry) => entry.key === 'pgdata' && entry.kind === 'directory') && entries.some((entry) => entry.key === 'control' && entry.kind === 'file') && source.volumes.every((volume) => volume.nodeUid === source.server.nodeUid);
});
async function captureStorage(source: NativePostgresSource | undefined, connection: NativeDdlConnection, allowUnsupported = true): Promise<NativePostgresStorageSource | null> {
  if (!source) return null;
  const deadline = Date.now() + 60_000;
  let delay = 50;
  for (;;) {
    await connection.assertHeld();
    try { return storageSchema.parse(await source.capture(connection)); }
    catch (error) {
      if (allowUnsupported && isPlatformError(error) && error.details['code'] === 'native_postgres_source_unsupported') return null;
      if (!isPlatformError(error) || error.details['code'] !== 'native_postgres_source_busy' || Date.now() >= deadline) throw error;
      await Bun.sleep(Math.min(delay, deadline - Date.now())); delay = Math.min(delay * 2, 1000);
    }
  }
}
async function catalog(connection: NativeDdlConnection, names: readonly string[]): Promise<CatalogIdentity[]> {
  return connection.query<CatalogIdentity[]>("SELECT 'database' AS kind,datname AS name,oid::text FROM pg_database WHERE datname IN (SELECT jsonb_array_elements_text($1::text::jsonb)) UNION ALL SELECT 'role' AS kind,rolname AS name,oid::text FROM pg_roles WHERE rolname IN (SELECT jsonb_array_elements_text($1::text::jsonb)) ORDER BY kind,name", [JSON.stringify(names)]);
}
async function commitJournal(db: Database, workId: string, side: 'before' | 'after', identities: readonly CatalogIdentity[], source: NativePostgresStorageSource | null) {
  await db.transaction(async (tx) => {
    await tx.execute(sql`SELECT set_config('crewstation.data_control_work_journal',${workId},true)`);
    const rows = side === 'before'
      ? await tx.execute(sql`UPDATE data_control.deletion_work SET catalog_before=${JSON.stringify(identities)}::jsonb,storage_before=${source ? JSON.stringify(source) : null}::jsonb WHERE work_id=${workId} AND state='running' RETURNING work_id`)
      : await tx.execute(sql`UPDATE data_control.deletion_work SET catalog_after=${JSON.stringify(identities)}::jsonb,storage_after=${source ? JSON.stringify(source) : null}::jsonb WHERE work_id=${workId} AND state='running' RETURNING work_id`);
    if (rows.length !== 1) throw precondition('原生身份记录没有提交到原回调');
  });
}
/** Each real callback retains both sides, including partially committed DDL that then throws. */
async function journaledEffect<T>(db: Database, workId: string, names: readonly string[], connection: NativeDdlConnection, observation: NativeDdlConnection, source: NativePostgresSource | undefined, effect: (connection: NativeDdlConnection) => Promise<T>): Promise<T> {
  const before = await captureStorage(source, connection);
  await commitJournal(db, workId, 'before', await catalog(connection, names), before);
  try { return await effect(connection); }
  finally {
    // Closing business admission rejects further caller DDL, not observation under the original native lock.
    const identities = await catalog(observation, names);
    let after: NativePostgresStorageSource | null = null;
    try { after = await captureStorage(source, observation, before === null); }
    finally { await commitJournal(db, workId, 'after', identities, after); }
    if (before && after?.identity !== before.identity) throw conflict('原生 PostgreSQL 原卷或数据目录已替换', { code: 'native_postgres_source_changed' });
  }
}

const catalogSchema = z.array(z.object({ kind: z.enum(['database', 'role']), name: z.string().regex(/^cs_[a-z0-9_]{1,60}$/), oid: z.string().regex(/^[1-9][0-9]{0,9}$/).refine((oid) => Number(oid) <= 4294967295) }));
const journalSchema = z.object({ work_id: identity, resource_id: identity, project_id: identity, names: z.array(z.string().regex(/^cs_[a-z0-9_]{1,60}$/)).min(1), state: z.enum(['running', 'finished']), journal_version: z.literal(1).nullable(), native_pid: z.number().int().positive().nullable(), native_started: identity.nullable(), source_identity: hash.nullable(), pod_uid: identity.nullable(), container_id: identity.nullable(), node_uid: identity.nullable(), node_name: identity.nullable(), proof_digest: hash.nullable(), catalog_before: catalogSchema.nullable(), catalog_after: catalogSchema.nullable(), storage_before: storageSchema.nullable(), storage_after: storageSchema.nullable() });
function journalRecord(value: unknown): NativePostgresJournalRecord {
  const row = journalSchema.parse(value);
  if ((row.native_pid === null) !== (row.native_started === null) || (row.native_pid === null) !== (row.source_identity === null) || [row.pod_uid, row.container_id, row.node_uid, row.node_name].some((key) => (key === null) !== (row.pod_uid === null))) throw precondition('原生回调历史的原来源不完整');
  for (const facts of [row.catalog_before, row.catalog_after]) {
    if (facts && (facts.some((fact) => !row.names.includes(fact.name)) || new Set(facts.map((fact) => fact.kind + ':' + fact.name)).size !== facts.length)) throw precondition('原生回调历史包含原锁范围外的身份');
  }
  return { workId: row.work_id, resourceId: row.resource_id, projectId: row.project_id as ProjectId, names: row.names, state: row.state, journalVersion: row.journal_version, nativeSession: row.native_pid === null ? null : { pid: row.native_pid, started: row.native_started!, sourceIdentity: row.source_identity! }, process: row.pod_uid === null ? null : { podUid: row.pod_uid, containerId: row.container_id!, nodeUid: row.node_uid!, nodeName: row.node_name! }, proofDigest: row.proof_digest, before: row.catalog_before === null ? null : { catalog: row.catalog_before, storage: row.storage_before }, after: row.catalog_after === null ? null : { catalog: row.catalog_after, storage: row.storage_after } };
}
async function readJournal(db: Database, projectId: ProjectId) {
  return db.transaction(async (tx) => {
    const records: NativePostgresJournalRecord[] = [];
    let cursor: string | undefined;
    for (;;) {
      const rows = await tx.execute<Record<string, unknown>>(sql`SELECT * FROM data_control.deletion_work WHERE project_id=${projectId} ${cursor ? sql`AND work_id>${cursor}` : sql``} ORDER BY work_id LIMIT 500`);
      records.push(...rows.map(journalRecord));
      if (rows.length < 500) break;
      cursor = records.at(-1)!.workId;
    }
    return { retainedRecordsComplete: true as const, records, revision: jsonHash({ projectId, records }) };
  }, { isolationLevel: 'repeatable read', accessMode: 'read only' });
}
