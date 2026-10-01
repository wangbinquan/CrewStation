import type { ProjectDeletionContext, ProjectId } from '@crewstation/contracts';
import { jsonHash, precondition } from '@crewstation/kernel';
import type { Database, Executor, Transaction } from '@crewstation/persistence';
import { withExclusiveDatabaseAdmission } from '@crewstation/persistence';
import { sql } from 'drizzle-orm';
import type { NativeDeletionRepository, NativeDeletionScope, NativeDeletionSnapshot } from '../../ports/dataPlane';
import { nativeAdmissionKey, readNativeJournalSnapshot } from './nativeWork';

type Fence = { operation_id: string | null; generation: number; confirmed_revision: string | null; completed_digest: string | null; completed_count: number };
type ScopeRow = { original: NativeDeletionScope; stop_digest: string | null; purge_digest: string | null; prove_digest: string | null; metadata_purged: boolean };
const schemaTables = ['deletion_fences', 'deletion_entities', 'deletion_work', 'deletion_scopes'];
async function registered(tx: Executor) {
  const rows = await tx.execute<{ table_name: string }>(sql`SELECT table_name FROM information_schema.columns WHERE table_schema='data_control' AND column_name='project_id'`);
  if (rows.some((row) => !schemaTables.includes(row.table_name))) throw precondition('数据库模块出现未登记的项目内容表');
}
async function page<T extends { resource_id: string }>(tx: Executor, table: string, where: ReturnType<typeof sql>, columns: ReturnType<typeof sql>): Promise<T[]> {
  const result: T[] = []; let after: string | undefined;
  for (;;) {
    const rows = await tx.execute<T>(sql`SELECT ${columns} FROM data_control.${sql.identifier(table)} WHERE ${where} ${after === undefined ? sql`` : sql`AND resource_id>${after}`} ORDER BY resource_id LIMIT 500`) as T[];
    result.push(...rows);
    if (rows.length < 500) return result;
    after = rows.at(-1)!.resource_id;
  }
}
async function readSnapshot(tx: Executor, projectId: ProjectId, keys: readonly string[]): Promise<NativeDeletionSnapshot> {
  await registered(tx);
  const selected = sql`resource_id IN (SELECT jsonb_array_elements_text(${JSON.stringify(keys)}::jsonb))`;
  const entityRows = await page<{ resource_id: string }>(tx, 'deletion_entities', sql`project_id=${projectId}`, sql`resource_id`);
  const credentials = await page<{ resource_id: string; role: string; digest: string }>(tx, 'credentials', sql`(resource_id IN (SELECT resource_id FROM data_control.deletion_entities WHERE project_id=${projectId}) OR ${selected})`, sql`resource_id,role,md5(secret_box || ':' || coalesce(pending_box,'')) AS digest`);
  const foreign = await page<{ resource_id: string }>(tx, 'deletion_entities', sql`project_id<>${projectId} AND ${selected}`, sql`resource_id`);
  const unknown = await page<{ resource_id: string }>(tx, 'credentials', sql`NOT EXISTS(SELECT 1 FROM data_control.deletion_entities e WHERE e.resource_id=credentials.resource_id) AND NOT (${selected})`, sql`resource_id`);
  const journal = (await readNativeJournalSnapshot(tx, projectId)).records;
  const entities = entityRows.map((row) => row.resource_id), entries = credentials.map((row) => ({ resourceId: row.resource_id, role: row.role, digest: row.digest }));
  const immutableJournal = journal.map(({ state: _state, proofDigest: _proof, ...facts }) => facts);
  const metadata = [['deletion_entities', entities], ['credentials', entries], ['deletion_work', immutableJournal]].map(([table, contents]) => ({ kind: 'metadata:' + String(table), id: projectId, identity: jsonHash(contents), count: (contents as readonly unknown[]).length, scope: 'metadata' as const }));
  return { entities, credentials: entries, journal, foreignKeys: foreign.map((row) => row.resource_id), unownedCredentials: unknown.map((row) => row.resource_id), metadata };
}
async function fence(tx: Executor, context: ProjectDeletionContext): Promise<Fence> {
  const [row] = await tx.execute<Fence>(sql`SELECT operation_id,generation,confirmed_revision,completed_digest,completed_count FROM data_control.deletion_fences WHERE project_id=${context.target.id} FOR UPDATE`);
  if (!row || row.operation_id !== context.operationId || row.generation > context.generation || row.confirmed_revision !== context.confirmed.revision) throw precondition('数据库永久清理的原操作、世代或确认摘要不符');
  if (row.generation < context.generation && !row.completed_digest) await tx.execute(sql`UPDATE data_control.deletion_fences SET generation=${context.generation} WHERE project_id=${context.target.id}`);
  return row;
}
async function mark(tx: Transaction, context: ProjectDeletionContext) {
  await tx.execute(sql`SELECT set_config('crewstation.data_control_deletion',${context.operationId},true),set_config('crewstation.data_control_deletion_phase',${context.phase},true),set_config('crewstation.data_control_deletion_generation',${String(context.generation)},true)`);
}
async function scopeRow(tx: Executor, context: ProjectDeletionContext) {
  const [row] = await tx.execute<ScopeRow>(sql`SELECT original,stop_digest,purge_digest,prove_digest,metadata_purged FROM data_control.deletion_scopes WHERE project_id=${context.target.id} AND operation_id=${context.operationId} FOR UPDATE`);
  return row;
}
const stableScope = (scope: NativeDeletionScope) => jsonHash({ keys: [...scope.plan.keys].sort(), names: scope.plan.names.map((row) => [row.kind, row.name]).sort(), catalog: scope.plan.catalog.map((row) => [row.kind, row.name, row.oid]).sort(), sessions: scope.plan.sessions.map((row) => [row.pid, row.started, row.sourceIdentity]).sort(), storage: scope.storage?.identity ?? null, databases: scope.databases.map((row) => row.identity).sort(), roles: scope.roles.map((row) => row.identity).sort(), absent: scope.absent.map((row) => [row.kind, row.name]).sort() });
async function empty(tx: Executor, id: ProjectId) {
  const [row] = await tx.execute<{ present: boolean }>(sql`SELECT EXISTS(SELECT 1 FROM data_control.deletion_entities WHERE project_id=${id}) OR EXISTS(SELECT 1 FROM data_control.deletion_work WHERE project_id=${id}) AS present`);
  return row?.present === false;
}

export function nativeDeletionRepository(db: Database, assertGrant: (context: ProjectDeletionContext) => Promise<void>): NativeDeletionRepository {
  const admitted = <T>(context: ProjectDeletionContext, work: (tx: Transaction, owned: Fence) => Promise<T>) => withExclusiveDatabaseAdmission(db, nativeAdmissionKey(context.target.id), async (tx) => {
    await assertGrant(context); const owned = await fence(tx, context); await mark(tx, context); return work(tx, owned);
  });
  return {
    snapshot: (id, keys) => db.transaction((tx) => readSnapshot(tx, id, keys), { isolationLevel: 'repeatable read', accessMode: 'read only' }),
    close: (context) => withExclusiveDatabaseAdmission(db, nativeAdmissionKey(context.target.id), async (tx) => {
      if (context.phase !== 'seal') throw precondition('数据库闭准入只能使用 seal 许可');
      await assertGrant(context); await registered(tx);
      await tx.execute(sql`INSERT INTO data_control.deletion_fences(project_id) VALUES (${context.target.id}) ON CONFLICT DO NOTHING`);
      const [row] = await tx.execute<Fence>(sql`SELECT operation_id,generation,confirmed_revision,completed_digest,completed_count FROM data_control.deletion_fences WHERE project_id=${context.target.id} FOR UPDATE`);
      if (!row || row.completed_digest || row.operation_id && (row.operation_id !== context.operationId || row.generation > context.generation || row.generation === context.generation && row.confirmed_revision !== context.confirmed.revision)) throw precondition('数据库清理许可不能替换原操作或回退世代');
      await tx.execute(sql`UPDATE data_control.deletion_fences SET operation_id=${context.operationId},generation=${context.generation},confirmed_revision=${context.confirmed.revision} WHERE project_id=${context.target.id}`);
    }),
    bind: (context, scope) => admitted(context, async (tx) => {
      if (context.phase !== 'seal') throw precondition('原数据库物理范围只能在 seal 固定');
      const previous = await scopeRow(tx, context);
      if (previous && stableScope(previous.original) !== stableScope(scope)) throw precondition('已固定的原数据库物理范围不可替换');
      if (!previous) await tx.execute(sql`INSERT INTO data_control.deletion_scopes(project_id,operation_id,original) VALUES (${context.target.id},${context.operationId},${JSON.stringify(scope)}::jsonb)`);
      await tx.execute(sql`INSERT INTO data_control.deletion_entities(resource_id,project_id) SELECT value,${context.target.id} FROM jsonb_array_elements_text(${JSON.stringify(scope.plan.keys)}::jsonb) ON CONFLICT DO NOTHING`);
      const [owners] = await tx.execute<{ matched: boolean }>(sql`SELECT NOT EXISTS(SELECT 1 FROM jsonb_array_elements_text(${JSON.stringify(scope.plan.keys)}::jsonb) keys LEFT JOIN data_control.deletion_entities entities ON entities.resource_id=keys.value WHERE entities.project_id IS DISTINCT FROM ${context.target.id}) AS matched`);
      if (owners?.matched !== true) throw precondition('原数据库凭据或历史别名属于其他项目');
    }),
    assert: (context) => admitted(context, async () => undefined),
    load: (context) => admitted(context, async (tx, owned) => {
      const row = await scopeRow(tx, context);
      return { scope: row?.original ?? null, proofs: { ...(row?.stop_digest ? { stop: row.stop_digest } : {}), ...(row?.purge_digest ? { purge: row.purge_digest } : {}), ...(row?.prove_digest ? { prove: row.prove_digest } : {}) }, metadataPurged: row?.metadata_purged ?? false, completed: owned.completed_digest ? { digest: owned.completed_digest, count: owned.completed_count } : null };
    }),
    record: (context, digest) => admitted(context, async (tx) => {
      if (!['stop', 'purge', 'prove'].includes(context.phase) || !/^[a-f0-9]{64}$/.test(digest)) throw precondition('原数据库阶段证明格式或阶段不符');
      const row = await scopeRow(tx, context);
      if (!row) throw precondition('原数据库物理意图尚未固定');
      const column = context.phase + '_digest';
      await tx.execute(sql`UPDATE data_control.deletion_scopes SET ${sql.identifier(column)}=coalesce(${sql.identifier(column)},${digest}) WHERE project_id=${context.target.id}`);
    }),
    purgeMetadata: (context) => admitted(context, async (tx) => {
      if (context.phase !== 'metadata') throw precondition('数据库秘密材料只能在 metadata 清理');
      await registered(tx); const row = await scopeRow(tx, context);
      if (!row?.stop_digest || !row.purge_digest || !row.prove_digest) throw precondition('原数据库尚未排空、物理回收并独立复核');
      const [running] = await tx.execute<{ present: boolean }>(sql`SELECT EXISTS(SELECT 1 FROM data_control.deletion_work WHERE project_id=${context.target.id} AND state='running') AS present`);
      if (running?.present !== false) throw precondition('原生回调尚未退出，不能清除原事实');
      await tx.execute(sql`UPDATE data_control.deletion_fences SET scope_verified=true WHERE project_id=${context.target.id}`);
      await tx.execute(sql`DELETE FROM data_control.credentials WHERE resource_id IN (SELECT resource_id FROM data_control.deletion_entities WHERE project_id=${context.target.id})`);
      await tx.execute(sql`DELETE FROM data_control.deletion_work WHERE project_id=${context.target.id}`);
      await tx.execute(sql`DELETE FROM data_control.deletion_entities WHERE project_id=${context.target.id}`);
      if (!await empty(tx, context.target.id)) throw precondition('数据库凭据、原在途事实或归属仍有残留');
      await tx.execute(sql`UPDATE data_control.deletion_scopes SET metadata_purged=true WHERE project_id=${context.target.id}`);
    }),
    complete: (context, digest, count) => admitted(context, async (tx) => {
      if (context.phase !== 'verify' || !/^[a-f0-9]{64}$/.test(digest) || !Number.isSafeInteger(count) || count < 0) throw precondition('数据库最终复核材料不合法');
      const row = await scopeRow(tx, context);
      if (!row?.metadata_purged || !await empty(tx, context.target.id)) throw precondition('数据库内容尚未清空，不能退为最小墓碑');
      await tx.execute(sql`UPDATE data_control.deletion_fences SET completed_digest=${digest},completed_count=${count} WHERE project_id=${context.target.id}`);
      await tx.execute(sql`DELETE FROM data_control.deletion_scopes WHERE project_id=${context.target.id}`);
    }),
  };
}
