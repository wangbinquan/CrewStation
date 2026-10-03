import { AsyncLocalStorage } from 'node:async_hooks';
import type { ClusterHistoryResource, ClusterInspection, ClusterOperation, ProjectDeletionContext, ProjectDeletionInventory, ProjectDeletionTarget } from '@crewstation/contracts';
import { ProjectDeletionContextSchema, ProjectDeletionInventorySchema } from '@crewstation/contracts';
import { jsonHash, newResourceId, precondition } from '@crewstation/kernel';
import type { Database, Executor, ResourceIdentityDirectory, Transaction } from '@crewstation/persistence';
import { assertSharedDatabaseAdmissionActive, withExclusiveDatabaseAdmission, withSharedDatabaseAdmission } from '@crewstation/persistence';
import { sql } from 'drizzle-orm';
import { z } from 'zod';
import type { InventorySnapshot, MetricsObservation, StorageResult } from '../../domain/observations';
import type { ClusterProjectScope } from '../../domain/projectDeletion';
import { clusterProjectScope, hasProjectContentReference, projectContentChanged, projectKey, projectResource, withoutProjectHistory, withoutProjectInspection, withoutProjectObservation, withoutProjectOperation, withoutProjectSnapshot, withoutProjectStorage } from '../../domain/projectDeletion';
import type { ClusterCallbackProcess, ClusterCallbackProcesses, ClusterDeletionRepository, ClusterDeletionStored, ClusterProjectAdmission } from '../../ports/repository';

const contentKey = 'cluster-management.project-content';
const admissionKey = (id: string) => 'cluster-management.project-admission:' + id;
const processSchema = z.object({ podUid: z.uuid(), containerId: z.string().regex(/^[a-z0-9]+:\/\/[a-f0-9]{64}$/), nodeUid: z.uuid(), nodeName: z.string().min(1).max(253) }).strict();
const scopeSchema = z.object({ projectId: z.string().min(1), namespace: z.string().min(1), serviceId: z.string().min(1).optional(), projectKeys: z.array(z.string().min(1)).optional(), serviceKeys: z.array(z.string().min(1)).optional(),
  resources: z.array(z.object({ id: z.string().min(1), uid: z.string().min(1) }).strict()), referenceHashes: z.array(z.string().regex(/^[a-f0-9]{64}$/)).optional() }).strict();
interface Input {
  db: Database; processes?: ClusterCallbackProcesses; identities?: Pick<ResourceIdentityDirectory, 'aliases' | 'resolve'>;
  assertAvailable?(projectId: string): Promise<void>; assertGrant?(context: ProjectDeletionContext): Promise<void>;
}
type ContentKind = 'snapshots' | 'inspections' | 'operations' | 'metric_observations' | 'metric_history' | 'metric_storage';
type Content = InventorySnapshot | ClusterInspection | ClusterOperation | MetricsObservation | ClusterHistoryResource | StorageResult[];
type Row = { id: string; body: Content; legacy_body?: Content | null; [key: string]: unknown };
type Change = { kind: ContentKind; row: Row; body: Content | null; legacy: Content | null | undefined };
type Fence = { project_id: string; operation_id: string; generation: number; revision: string; original: ClusterProjectScope; scope_verified: boolean;
  stopped: boolean; purged: boolean; proved: boolean; metadata_purged: boolean; completed_digest: string | null; completed_count: number };
const tables: readonly ContentKind[] = ['snapshots', 'inspections', 'operations', 'metric_observations', 'metric_history', 'metric_storage'];
const columns: Readonly<Record<string, readonly string[]>> = {
  snapshots: ['id', 'sequence', 'created_at', 'body', 'legacy_body', 'identity_provenance'],
  inspections: ['id', 'actor_id', 'created_at', 'body', 'legacy_body', 'identity_provenance'],
  operations: ['id', 'actor_id', 'idempotency_key', 'request_hash', 'fence', 'created_at', 'body', 'legacy_body', 'identity_provenance', 'identity_agent_restart', 'identity_domain_kind'],
  refreshes: ['id', 'request_id', 'requested_at', 'state'], refresh_history: ['id'], resource_identities: ['id', 'uid'], resource_identity_aliases: ['kind', 'key', 'id'],
  metric_observations: ['id', 'created_at', 'body'], metric_history: ['id', 'last_seen', 'body'], metric_storage: ['id', 'updated_at', 'body'], metric_collectors: ['kind', 'request_id', 'fence', 'state', 'requested_at'],
  deletion_fences: ['project_id', 'operation_id', 'generation', 'revision', 'original', 'scope_verified', 'stopped', 'purged', 'proved', 'metadata_purged', 'completed_digest', 'completed_count'],
  deletion_work: ['id', 'project_id', 'operation_id', 'backend_pid', 'callback_pid', 'callback_started_at', 'process', 'state', 'exit_digest', 'recovery_digest'],
  deletion_legacy_operations: ['operation_id'],
  // Immutable minimum IDs; original queue/event sources remain readable after content purge.
  infrastructure_origins: ['kind', 'id', 'material'],
};
const table = (name: string) => sql`${sql.identifier('cluster_management')}.${sql.identifier(name)}`;
const sorted = (keys: readonly string[]) => [...new Set(keys)].sort();
const digestValid = (digest: string) => /^[a-f0-9]{64}$/.test(digest);
const lockTimeout = (error: unknown): boolean => !!error && typeof error === 'object' && ('code' in error && error.code === '55P03' || 'cause' in error && lockTimeout(error.cause));
async function knownColumns(db: Executor) {
  const found = await db.execute<{ table_name: string; column_name: string }>(sql`SELECT table_name,column_name FROM information_schema.columns WHERE table_schema='cluster_management' ORDER BY table_name,column_name`);
  if (found.some((entry) => !columns[entry.table_name]?.includes(entry.column_name))) throw precondition('集群管理存在未登记的内容表或列，不能解释为已清空');
}
async function scopes(db: Executor): Promise<ClusterProjectScope[]> {
  return (await db.execute<{ original: ClusterProjectScope }>(sql`SELECT original FROM cluster_management.deletion_fences ORDER BY project_id`)).map((row) => scopeSchema.parse(row.original));
}
function storageScope(scope: ClusterProjectScope, observations: readonly MetricsObservation[], histories: readonly ClusterHistoryResource[]): ClusterProjectScope {
  const others = new Set([...observations.flatMap((value) => value.usages.filter((usage) => usage.scope === 'system' || usage.scope === 'project' && !projectKey(scope, usage.projectId)).map((usage) => usage.uid)),
    ...histories.filter((history) => !history.deleted && (history.scope === 'system' || history.scope === 'project' && !projectKey(scope, history.projectId))).map((history) => history.uid)]);
  return { ...scope, resources: scope.resources.filter((entry) => !others.has(entry.uid)) };
}
function projectContent(kind: ContentKind, value: Content, scope: ClusterProjectScope): Content | null {
  switch (kind) {
    case 'snapshots': return withoutProjectSnapshot(value as InventorySnapshot, scope);
    case 'inspections': return withoutProjectInspection(value as ClusterInspection, scope);
    case 'operations': return withoutProjectOperation(value as ClusterOperation, scope);
    case 'metric_observations': return withoutProjectObservation(value as MetricsObservation, scope);
    case 'metric_history': return withoutProjectHistory(value as ClusterHistoryResource, scope);
    case 'metric_storage': return withoutProjectStorage(value as StorageResult[], scope);
  }
}
/** This short shared lock covers the scope read and commit, never an external callback. */
export async function lockClusterContent(tx: Transaction): Promise<void> {
  await tx.execute(sql`SELECT pg_advisory_xact_lock_shared(hashtextextended(${contentKey},0))`);
}
export async function prepareClusterContent<T extends Content>(tx: Transaction, kind: ContentKind, value: T): Promise<T | null> {
  await lockClusterContent(tx);
  let result: Content | null = value;
  const sealed = await scopes(tx);
  const observations = kind === 'metric_storage' ? (await tx.execute<{ body: MetricsObservation }>(sql`SELECT body FROM cluster_management.metric_observations ORDER BY created_at DESC LIMIT 1`)).map((row) => row.body) : [];
  const histories = kind === 'metric_storage' ? (await tx.execute<{ body: ClusterHistoryResource }>(sql`SELECT body FROM cluster_management.metric_history`)).map((row) => row.body) : [];
  for (const scope of sealed) if (result !== null) result = projectContent(kind, result, kind === 'metric_storage' ? storageScope(scope, observations, histories) : scope);
  return result as T | null;
}
async function aliases(input: Input, kind: string, id: string): Promise<string[]> {
  if (!input.identities) throw precondition('集群历史旧标识来源未装配');
  const keys = await input.identities.aliases(kind, id), selected: string[] = [id];
  for (const key of keys) {
    if (await input.identities.resolve(kind, key) !== id) throw precondition('集群历史旧标识的原身份冲突');
    if (key.length === 1) selected.push(key[0]!);
  }
  return sorted(selected);
}
async function contentRows(db: Executor): Promise<Map<ContentKind, Row[]>> {
  const result = new Map<ContentKind, Row[]>();
  for (const kind of tables) result.set(kind, await db.execute<Row>(sql`SELECT * FROM ${table(kind)} ORDER BY id`));
  return result;
}
async function captureScope(input: Input, db: Executor, target: ProjectDeletionTarget, rows: Map<ContentKind, Row[]>): Promise<ClusterProjectScope> {
  const retained = (await db.execute<{ original: ClusterProjectScope }>(sql`SELECT original FROM cluster_management.deletion_fences WHERE project_id=${target.id}`))[0]?.original;
  const base = retained ? scopeSchema.parse(retained) : { projectId: target.id, namespace: target.namespace, ...(target.serviceId ? { serviceId: target.serviceId } : {}), resources: [],
    projectKeys: await aliases(input, 'project', target.id), serviceKeys: target.serviceId ? await aliases(input, 'service', target.serviceId) : [] };
  const documents = (kind: ContentKind) => rows.get(kind)!.flatMap((row) => [row.body, ...(row.legacy_body ? [row.legacy_body] : [])]);
  const snapshots = documents('snapshots') as InventorySnapshot[], observations = documents('metric_observations') as MetricsObservation[];
  const histories = [...documents('metric_history') as ClusterHistoryResource[], ...observations.flatMap((value) => value.identities)];
  const targets = [...documents('inspections') as ClusterInspection[], ...documents('operations') as ClusterOperation[]].flatMap((value) => [value.target, ...('after' in value && value.after ? [value.after] : [])]);
  const scope = clusterProjectScope(target, snapshots, histories, base, targets);
  const identities = await db.execute<{ id: string; uid: string }>(sql`SELECT id,uid FROM cluster_management.resource_identities ORDER BY id`);
  const originalAliases = await db.execute<{ id: string; key: string }>(sql`SELECT id,key FROM cluster_management.resource_identity_aliases WHERE kind='cluster-resource' ORDER BY id,key`);
  const entries = [...scope.resources, ...identities.filter((identity) => scope.resources.some((entry) => entry.uid === identity.uid)).flatMap((identity) => {
    const keys = originalAliases.filter((entry) => entry.id === identity.id).map((entry) => z.array(z.string().min(1)).parse(JSON.parse(entry.key))).filter((key) => key.length === 1);
    return [{ id: identity.id, uid: identity.uid }, ...keys.map((key) => ({ id: key[0]!, uid: identity.uid }))];
  })];
  const resources = [...new Map(entries.map((entry) => [entry.id, entry])).values()].sort((a, b) => a.id.localeCompare(b.id));
  if (entries.some((entry) => resources.find((original) => original.id === entry.id)?.uid !== entry.uid)) throw precondition('集群内容标识不属于原 UID');
  return scopeSchema.parse({ ...scope, resources });
}
function contentChanges(rows: Map<ContentKind, Row[]>, scope: ClusterProjectScope): Change[] {
  const storage = storageScope(scope, (rows.get('metric_observations')!).map((row) => row.body as MetricsObservation), (rows.get('metric_history')!).map((row) => row.body as ClusterHistoryResource));
  return tables.flatMap((kind) => rows.get(kind)!.flatMap<Change>((row) => {
    const selected = kind === 'metric_storage' ? storage : scope, body = projectContent(kind, row.body, selected);
    const legacy = row.legacy_body ? projectContent(kind, row.legacy_body, selected) : row.legacy_body;
    if (body === null) return [{ kind, row, body, legacy }];
    return projectContentChanged(row.body, body) || projectContentChanged(row.legacy_body ?? null, legacy ?? null) ? [{ kind, row, body, legacy }] : [];
  }));
}
async function inspectContent(input: Input, db: Executor, target: ProjectDeletionTarget) {
  await knownColumns(db);
  const rows = await contentRows(db), scope = await captureScope(input, db, target, rows), changes = contentChanges(rows, scope);
  const blockers: ProjectDeletionInventory['blockers'] = [];
  if (changes.some((change) => change.body === null && change.row.legacy_body && change.legacy !== null)) {
    blockers.push({ participant: 'cluster-management', code: 'cluster-current-legacy-owner-conflict', message: '当前记录与旧版备份分属不同项目，保留原内容并核对来源' });
  }
  if (tables.some((kind) => rows.get(kind)!.some((row) => [row.body, row.legacy_body].some((value) => value && hasProjectContentReference(projectContent(kind, value, scope), scope))))) {
    blockers.push({ participant: 'cluster-management', code: 'cluster-content-reference-unknown', message: '共享集群内容仍包含无法识别的原项目或服务引用，不能解释为已清空' });
  }
  const unknown = (rows.get('snapshots')!).flatMap((row) => [row.body as InventorySnapshot, ...(row.legacy_body ? [row.legacy_body as InventorySnapshot] : [])])
    .flatMap((snapshot) => snapshot.resources).filter((resource) => resource.namespace === target.namespace && resource.ownership.scope === 'unresolved' && !projectResource(resource, scope));
  if (unknown.length) blockers.push({ participant: 'cluster-management', code: 'cluster-content-owner-unknown', message: '本项目命名空间的部分旧快照缺少原 UID 归属，不能按同名删除' });
  const histories = [...(rows.get('metric_history')!).map((row) => row.body as ClusterHistoryResource), ...(rows.get('metric_observations')!).flatMap((row) => (row.body as MetricsObservation).identities)];
  if (histories.some((history) => scope.resources.some((entry) => entry.id === history.resourceId && entry.uid === history.uid) && history.versions.some((version) => version.scope === 'unresolved')
    && history.versions.some((version) => version.scope === 'system' || version.scope === 'project' && !projectKey(scope, version.projectId)))) {
    blockers.push({ participant: 'cluster-management', code: 'cluster-history-owner-ambiguous', message: '混合归属的旧资源历史还有未识别的版本，不能推断其项目归属' });
  }
  const owned = (rows.get('operations')!).filter((row) => projectResource((row.body as ClusterOperation).target, scope));
  const original = await db.execute<{ operation_id: string }>(sql`SELECT operation_id FROM cluster_management.deletion_legacy_operations`);
  const work = await db.execute(sql`SELECT * FROM cluster_management.deletion_work WHERE project_id=${target.id} ORDER BY id`);
  if (owned.some((row) => original.some((entry) => entry.operation_id === row.id) || !['succeeded', 'failed'].includes((row.body as ClusterOperation).phase) && !work.some((entry) => entry['operation_id'] === row.id))) {
    blockers.push({ participant: 'cluster-management', code: 'cluster-callback-origin-unknown', message: '部分旧集群操作缺少实际回调退出来源，不能把租约或连接消失当作排空' });
  }
  const resources = changes.map(({ kind, row, body, legacy }) => ({ kind: 'metadata:cluster-' + kind, id: row.id, identity: jsonHash({ before: row, body, legacy }), scope: 'metadata' as const, count: 1 }));
  if (work.length) resources.push({ kind: 'metadata:cluster-callbacks', id: target.id, identity: jsonHash(work), scope: 'metadata', count: work.length });
  const inventory = ProjectDeletionInventorySchema.parse({ participant: 'cluster-management', revision: jsonHash(resources), resources, blockers, references: [], complete: blockers.length === 0 });
  return { inventory, scope, changes };
}
async function originalFence(tx: Transaction, context: ProjectDeletionContext): Promise<Fence> {
  const row = (await tx.execute<Fence>(sql`SELECT * FROM cluster_management.deletion_fences WHERE project_id=${context.target.id} FOR UPDATE`))[0];
  if (!row || row.operation_id !== context.operationId || row.generation !== context.generation || row.revision !== context.confirmed.revision) throw precondition('集群内容清理的原操作、世代或确认修订已变化');
  row.original = scopeSchema.parse(row.original);
  if (row.original.namespace !== context.target.namespace || row.original.serviceId !== context.target.serviceId) throw precondition('集群清理许可不属于原项目范围');
  return row;
}
async function permission(input: Input, raw: ProjectDeletionContext): Promise<ProjectDeletionContext> {
  const context = ProjectDeletionContextSchema.parse(raw);
  if (context.confirmed.participant !== 'cluster-management' || !context.confirmed.complete || context.confirmed.blockers.length || context.confirmed.references.length || !input.assertGrant) throw precondition('缺少完整的集群内容清理许可');
  await input.assertGrant(context); return context;
}
async function mark(tx: Transaction, context: ProjectDeletionContext) {
  await tx.execute(sql`SELECT set_config('crewstation.cluster_deletion_owner',${context.operationId + ':' + context.generation + ':' + context.phase},true)`);
}
export function clusterDeletionRepository(input: Input): ClusterDeletionRepository {
  const admitted = async <T>(raw: ProjectDeletionContext, work: (tx: Transaction, row: Fence) => Promise<T>) => {
    const context = await permission(input, raw);
    return withExclusiveDatabaseAdmission(input.db, admissionKey(context.target.id), async (tx) => {
      await input.assertGrant!(context); await mark(tx, context);
      const result = await work(tx, await originalFence(tx, context)); await input.assertGrant!(context); return result;
    });
  };
  return {
    inspect: (target) => input.db.transaction((tx) => inspectContent(input, tx, target), { isolationLevel: 'repeatable read', accessMode: 'read only' }),
    seal: async (raw) => {
      const context = await permission(input, raw);
      if (context.phase !== 'seal') throw precondition('集群内容准入只能在 seal 封闭');
      return withExclusiveDatabaseAdmission(input.db, admissionKey(context.target.id), async (tx) => {
        await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtextextended(${contentKey},0))`); await input.assertGrant!(context); await mark(tx, context);
        const old = (await tx.execute<Fence>(sql`SELECT * FROM cluster_management.deletion_fences WHERE project_id=${context.target.id} FOR UPDATE`))[0];
        if (old && (old.operation_id !== context.operationId || old.generation > context.generation || old.completed_digest || old.generation === context.generation && old.revision !== context.confirmed.revision)) throw precondition('集群内容封闭不能替换原操作或确认');
        const current = await inspectContent(input, tx, context.target), verified = current.inventory.complete && current.inventory.revision === context.confirmed.revision;
        if (old && old.generation === context.generation) return old.scope_verified;
        await tx.execute(sql`INSERT INTO cluster_management.deletion_fences(project_id,operation_id,generation,revision,original,scope_verified)
          VALUES(${context.target.id},${context.operationId},${context.generation},${context.confirmed.revision},${JSON.stringify(current.scope)}::jsonb,${verified})
          ON CONFLICT(project_id) DO UPDATE SET generation=excluded.generation,revision=excluded.revision,scope_verified=excluded.scope_verified`);
        await input.assertGrant!(context); return verified;
      }).catch(async (error: unknown) => { if (!lockTimeout(error)) throw error; await input.assertGrant!(context); return 'waiting' as const; });
    },
    load: (context) => admitted(context, async (_tx, row): Promise<ClusterDeletionStored> => ({ scope: row.original, verified: row.scope_verified, stopped: row.stopped, purged: row.purged, proved: row.proved,
      metadataPurged: row.metadata_purged, cleanedCount: row.completed_count, completed: row.completed_digest ? { digest: row.completed_digest, count: row.completed_count } : null })),
    stop: async (context) => {
      if (context.phase !== 'stop') throw precondition('集群回调退出只能在 stop 核对');
      await permission(input, context); await recoverCallbacks(input, context);
      return admitted(context, async (tx, row) => {
        if (!row.scope_verified) throw precondition('集群内容尚未重新确认');
        const [pending] = await tx.execute<{ count: number }>(sql`SELECT count(*)::int AS count FROM cluster_management.deletion_work WHERE project_id=${context.target.id} AND (state<>'exited' OR exit_digest IS NULL)`);
        if (!pending || pending.count !== 0) return false;
        await tx.execute(sql`UPDATE cluster_management.deletion_fences SET stopped=true WHERE project_id=${context.target.id}`); return true;
      });
    },
    record: (context) => admitted(context, async (tx, row) => {
      if (context.phase === 'purge' && row.stopped) await tx.execute(sql`UPDATE cluster_management.deletion_fences SET purged=true WHERE project_id=${context.target.id}`);
      else if (context.phase === 'prove' && row.purged) await tx.execute(sql`UPDATE cluster_management.deletion_fences SET proved=true WHERE project_id=${context.target.id}`);
      else throw precondition('集群内容阶段缺少上一阶段证明');
    }),
    purge: (context) => admitted(context, async (tx, row) => {
      if (context.phase !== 'metadata' || !row.scope_verified || !row.stopped || !row.purged || !row.proved) throw precondition('集群内容尚未封闭、排空和完成前序证明');
      if (row.metadata_purged) return row.completed_count;
      await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtextextended(${contentKey},0))`);
      const current = await inspectContent(input, tx, context.target);
      if (!current.inventory.complete) throw precondition('集群内容存在未知原来源，保留原材料');
      for (const { kind, row: content, body, legacy } of current.changes) {
        if (body === null) await tx.execute(sql`DELETE FROM ${table(kind)} WHERE id=${content.id}`);
        else await tx.execute(sql`UPDATE ${table(kind)} SET body=${JSON.stringify(body)}::jsonb ${content.legacy_body ? sql`,legacy_body=${legacy === null ? null : JSON.stringify(legacy)}::jsonb,identity_provenance=NULL` : sql``} WHERE id=${content.id}`);
      }
      await tx.execute(sql`DELETE FROM cluster_management.deletion_work WHERE project_id=${context.target.id}`);
      const after = await inspectContent(input, tx, context.target);
      if (!after.inventory.complete || after.changes.length || after.inventory.resources.length) throw precondition('集群历史和指标仍有项目内容');
      await tx.execute(sql`UPDATE cluster_management.deletion_fences SET metadata_purged=true,completed_count=${current.changes.length} WHERE project_id=${context.target.id}`);
      return current.changes.length;
    }),
    complete: (context, digest) => admitted(context, async (tx, row) => {
      if (context.phase !== 'verify' || !digestValid(digest) || !row.metadata_purged) throw precondition('集群内容没有最终复核许可');
      await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtextextended(${contentKey},0))`);
      const current = await inspectContent(input, tx, context.target);
      if (!current.inventory.complete || current.inventory.resources.length) throw precondition('集群内容仍有残留');
      // Only minimal original IDs remain to reject late old observations; no names, payloads or metric values.
      await tx.execute(sql`UPDATE cluster_management.deletion_fences SET completed_digest=${digest} WHERE project_id=${context.target.id}`);
    }),
  };
}

type Callback = { id: string; project_id: string; operation_id: string; backend_pid: number; callback_pid: number; callback_started_at: string; process: ClusterCallbackProcess | null; state: string };
const callbacks = new AsyncLocalStorage<{ db: Database; id: string; projectId: string; operationId: string; active: boolean }>();
const callbackStartedAt = new Date(Date.now() - process.uptime() * 1000).toISOString();
const protectedCallback = (id: string) => sql`EXISTS(SELECT 1 FROM pg_catalog.pg_locks WHERE locktype='advisory' AND granted AND mode='ShareLock' AND pid=w.backend_pid
  AND database=(SELECT oid FROM pg_catalog.pg_database WHERE datname=current_database()) AND objsubid=1
  AND classid::bigint=((hashtextextended(${admissionKey(id)},0)>>32)&4294967295) AND objid::bigint=(hashtextextended(${admissionKey(id)},0)&4294967295))`;
async function recoverCallbacks(input: Input, context?: ProjectDeletionContext) {
  if (!input.processes) return;
  await input.processes.sweep({
    stopped: async (original, digest) => {
      original = processSchema.parse(original); if (!digestValid(digest)) throw precondition('原集群回调容器停止摘要不合法');
      await input.db.transaction(async (tx) => {
        if (context) await permission(input, context);
        const work = await tx.execute<Callback>(sql`SELECT * FROM cluster_management.deletion_work w WHERE state='running' AND process=${JSON.stringify(original)}::jsonb ${context ? sql`AND project_id=${context.target.id}` : sql``} FOR UPDATE`);
        for (const row of work) {
          const [protectedRow] = await tx.execute<{ protected: boolean }>(sql`SELECT ${protectedCallback(row.project_id)} AS protected FROM cluster_management.deletion_work w WHERE id=${row.id}`);
          if (protectedRow?.protected !== false) continue;
          const proof = jsonHash({ id: row.id, operationId: row.operation_id, process: original, backendPid: row.backend_pid, source: digest });
          await tx.execute(sql`SELECT set_config('crewstation.cluster_callback_exit',${row.id + ':' + row.backend_pid},true)`);
          await tx.execute(sql`UPDATE cluster_management.deletion_work SET state='exited',exit_digest=${proof},recovery_digest=${digest} WHERE id=${row.id}`);
        }
      });
    },
    releasable: async (podUid) => Number((await input.db.execute<{ count: number }>(sql`SELECT count(*)::int AS count FROM cluster_management.deletion_work WHERE state='running' AND process->>'podUid'=${podUid}`))[0]?.count ?? 1) === 0,
  });
}
export function clusterProjectAdmission(input: Input): ClusterProjectAdmission {
  const assertActive = () => {
    const current = callbacks.getStore();
    if (!current || current.db !== input.db || !current.active) throw precondition('原集群操作回调已退出');
    assertSharedDatabaseAdmissionActive(input.db, admissionKey(current.projectId));
  };
  return { assertActive, observe: () => recoverCallbacks(input), withAdmission: async (projectId, operationId, work) => {
    const current = callbacks.getStore();
    if (current?.db === input.db) {
      if (current.projectId !== projectId || current.operationId !== operationId) throw precondition('不能扩展原集群操作回调');
      assertActive(); return work();
    }
    if (input.assertAvailable) await input.assertAvailable(projectId);
    return withSharedDatabaseAdmission(input.db, admissionKey(projectId), async (protectedTx) => {
      if (input.assertAvailable) await input.assertAvailable(projectId);
      if ((await input.db.execute(sql`SELECT project_id FROM cluster_management.deletion_fences WHERE project_id=${projectId}`)).length) throw precondition('项目集群操作正在永久清理');
      const original = input.processes ? processSchema.parse(await input.processes.protectCurrent()) : null;
      const backendPid = Number((await protectedTx.execute<{ pid: number }>(sql`SELECT pg_backend_pid() AS pid`))[0]!.pid), id = newResourceId();
      await input.db.transaction(async (tx) => { await tx.execute(sql`INSERT INTO cluster_management.deletion_work(id,project_id,operation_id,backend_pid,callback_pid,callback_started_at,process)
        VALUES(${id},${projectId},${operationId},${backendPid},${process.pid},${callbackStartedAt},${original ? JSON.stringify(original) : null}::jsonb)`); });
      const scope = { db: input.db, id, projectId, operationId, active: true };
      return callbacks.run(scope, async () => {
        try { assertActive(); return await work(); }
        finally {
          try {
            await input.db.transaction(async (tx) => {
              const [row] = await tx.execute<Callback>(sql`SELECT * FROM cluster_management.deletion_work WHERE id=${id} AND backend_pid=${backendPid} FOR UPDATE`);
              if (!row || row.state !== 'running') throw precondition('原集群回调退出事实已变化');
              await tx.execute(sql`SELECT set_config('crewstation.cluster_callback_exit',${id + ':' + backendPid},true)`);
              await tx.execute(sql`UPDATE cluster_management.deletion_work SET state='exited',exit_digest=${jsonHash({ id, projectId, operationId, backendPid, callbackPid: row.callback_pid, callbackStartedAt: row.callback_started_at, process: row.process })} WHERE id=${id}`);
            });
          } finally { scope.active = false; }
        }
      });
    });
  } };
}
