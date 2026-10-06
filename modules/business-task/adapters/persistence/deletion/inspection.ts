import { ProjectIdSchema, ResourceIdSchema } from '@crewstation/contracts';
import type { ProjectDeletionInventory, ProjectDeletionTarget, ProjectId } from '@crewstation/contracts';
import { jsonHash, precondition } from '@crewstation/kernel';
import type { Database, Executor } from '@crewstation/persistence';
import { readTransactionPages } from '@crewstation/persistence';
import { sql } from 'drizzle-orm';
import { z } from 'zod';
import type { BusinessContentOrigin, BusinessDeletionContent } from '../../../domain/deletion/content';
import type { BusinessDeletionSources } from '../../../ports/deletion/sources';
import { BUSINESS_CONTENT } from './contentTables';
import { retainedBusinessChild } from './operatorRepairs';
import { retainedNativeExecutions } from './nativeExecutionRepairs';

const originSchema = z.object({ complete: z.literal(true), id: ResourceIdSchema, scope: z.enum(['project', 'platform']),
  projectIds: z.array(ProjectIdSchema), revision: z.string().regex(/^[a-f0-9]{64}$/) }).strict().superRefine((value, context) => {
  if (new Set(value.projectIds).size !== value.projectIds.length || value.scope === 'platform' && value.projectIds.length !== 0 || value.scope === 'project' && value.projectIds.length !== 1)
    context.addIssue({ code: 'custom', message: '业务清理的原归属不完整或共享' });
});
interface Row extends Record<string, unknown> { key: string; digest: string; service: string | null; project: string | null; task: string | null; runtime: string | null; invalid: boolean;
  old_runtime: string | null }

export async function registeredBusinessContent(db: Executor): Promise<void> {
  const known = new Set([...BUSINESS_CONTENT.map(({ table }) => table), 'resource_identity_aliases', 'project_admissions', 'callback_pod_stops', 'content_origins', 'project_deletions', 'operator_confirmations']);
  const tables = await db.execute<{ table_name: string }>(sql`SELECT table_name FROM information_schema.tables WHERE table_schema='business_task' AND table_type='BASE TABLE'`);
  if (tables.some((row) => !known.has(row.table_name)) || BUSINESS_CONTENT.some(({ table }) => !tables.some((row) => row.table_name === table)))
    throw precondition('业务任务存在未登记或缺失的内容表，不能确认全部清理范围');
  for (const [table, columns] of Object.entries({ project_admissions: ['project_id', 'operation_id', 'generation', 'revision'], callback_pod_stops: ['identity', 'original_process', 'digest'],
    content_origins: ['kind', 'key', 'id', 'project_id', 'identity'], project_deletions: ['project_id', 'operation_id', 'generation', 'revision', 'body', 'phases', 'verified'] })) {
    const actual = await db.execute<{ column_name: string }>(sql`SELECT column_name FROM information_schema.columns WHERE table_schema='business_task' AND table_name=${table} ORDER BY column_name`);
    if (jsonHash(actual.map((row) => row.column_name)) !== jsonHash([...columns].sort())) throw precondition('业务最小封写／停止事实列发生未登记变化');
  }
  const aliases = await db.execute(sql`SELECT 1 FROM business_task.resource_identity_aliases WHERE kind IN('task','subtask')
    AND jsonb_array_length(key::jsonb)=1 AND key::jsonb->>0 ~ '^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
    AND id IS DISTINCT FROM key::jsonb->>0 LIMIT 1`);
  if (aliases.length) throw precondition('业务当前对象的原标识目录冲突');
}

type OriginalSource = (kind: 'service' | 'task', key: string, representation?: 'current' | 'legacy') => Promise<{ project: ProjectId | null; digest: string }>;
function taskSource(db: Executor, source: OriginalSource, project: ProjectId, origins: Map<string, BusinessContentOrigin>) {
  const tasks = new Map<string, Promise<{ project: ProjectId | null; digest: string }>>();
  return (id: string) => {
    const current = tasks.get(id); if (current) return current;
    const pending = (async () => {
      ResourceIdSchema.parse(id);
      const rows = await db.execute<{ service_id: string; project_id: string }>(sql`SELECT service_id,project_id FROM business_task.tasks WHERE id=${id}
        UNION SELECT service_id,intent->>'projectId' FROM business_task.execution_operations WHERE kind='create-task' AND intent->'task'->>'id'=${id}`);
      if (!rows.length) throw precondition('业务内容缺少原任务根，不能由子记录猜测归属');
      const facts = await Promise.all(rows.map(async (row) => {
        const original = await source('service', row.service_id);
        if (original.project !== ProjectIdSchema.parse(row.project_id)) throw precondition('业务任务根与原服务项目冲突');
        return { project: original.project, digest: jsonHash({ id, service: row.service_id, project: row.project_id, origin: original.digest }) };
      }));
      if (new Set(facts.map((value) => value.digest)).size !== 1) throw precondition('业务任务的原受理根存在冲突');
      if (facts[0]!.project === project) origins.set('business-task:' + id, { kind: 'task', key: id, id, projectId: project, identity: jsonHash({ kind: 'task', key: id, id, projectId: project }) });
      return facts[0]!;
    })();
    tasks.set(id, pending); return pending;
  };
}

/** One actual read-only snapshot; all content is traversed to EOF, but only hashes and minimum identity links leave PostgreSQL. */
export async function inspectBusinessContent(db: Executor, sources: BusinessDeletionSources, rawProject: ProjectId, target?: ProjectDeletionTarget) {
  const project = ProjectIdSchema.parse(rawProject), contents: BusinessDeletionContent[] = [], resources: ProjectDeletionInventory['resources'] = [];
  const origins = new Map<string, BusinessContentOrigin>();
  const retained: string[] = [];
  const cache = new Map<string, Promise<{ project: ProjectId | null; digest: string }>>(), counts: Record<string, number> = {};
  await registeredBusinessContent(db);
  const source = (kind: 'service' | 'task', key: string, representation: 'current' | 'legacy' = ResourceIdSchema.safeParse(key).success ? 'current' : 'legacy') => {
    const cacheKey = JSON.stringify([kind, key, representation]);
    let value = cache.get(cacheKey);
    if (!value) {
      value = (async () => {
        const original = await sources.resolve(kind, key, representation);
        if (!original) throw precondition('业务历史' + (kind === 'service' ? '服务 ' : '任务 ') + key + ' 缺少原项目归属记录，请恢复来源后重新盘点');
        const origin = originSchema.parse(original);
        if (representation === 'current' && origin.id !== key) throw precondition('业务内容与原对象 ID 不符');
        if (origin.projectIds[0] === project) origins.set(cacheKey, { kind, key, id: origin.id, projectId: project, identity: jsonHash({ kind, key, id: origin.id, projectId: project }) });
        return { project: origin.projectIds[0] ?? null, digest: jsonHash(origin) };
      })();
      cache.set(cacheKey, value);
    }
    return value;
  };
  const task = taskSource(db, source, project, origins);
  const nativeRetained = target ? await retainedNativeExecutions(db, sources, sources.currentAssets, target) : new Map();
  for (const entry of BUSINESS_CONTENT) {
    let after: string | null = null; const selected: BusinessDeletionContent[] = []; counts[entry.table] = 0;
    const field = (value?: string) => sql.raw(value ?? 'NULL::text');
    const key = sql.raw('jsonb_build_array(' + entry.keys.map((column) => 'r.' + column).join(',') + ')::text');
    const body = sql.raw(entry.table === 'original_callbacks' ? "to_jsonb(r)-ARRAY['exited_at','exit_digest','recovery_digest']" : 'to_jsonb(r)');
    await readTransactionPages<Row>(db, sql`SELECT ${key} AS key,encode(sha256(convert_to((${body})::text,'UTF8')),'hex') AS digest,
        ${field(entry.service)} AS service,${field(entry.project)} AS project,${field(entry.task)} AS task,${field(entry.runtime)} AS runtime,
        ${sql.raw(entry.invalid ?? 'false')} AS invalid,${sql.raw(entry.table === 'cluster_commands' ? "r.legacy_body->'operation'->'target'->>'taskId'" : entry.table === 'subtasks' ? "r.legacy_spec->'execution'->>'taskId'" : 'NULL::text')} AS old_runtime
        FROM ${sql.raw(entry.from ?? 'business_task.' + entry.table + ' r')}
        ORDER BY ${key} COLLATE "C"`, async (rows) => {
      for (const row of rows) {
        if (row.invalid || after !== null && Buffer.compare(Buffer.from(row.key), Buffer.from(after)) <= 0) throw precondition('业务原内容关系或完整分页不符');
        const nativeDecision = nativeRetained.get(entry.table + ':' + row.key);
        if (nativeDecision?.digest === row.digest) { retained.push(nativeDecision.decision); counts[entry.table]!++; after = row.key; continue; }
        if (entry.table === 'subtasks' && target) {
          const decision = await retainedBusinessChild(db, sources, sources.currentAssets, target, row.key, row.digest);
          if (decision) { retained.push(decision); counts[entry.table]!++; after = row.key; continue; }
        }
        const facts = [];
        if (row.service !== null) facts.push(await source('service', row.service));
        else if (entry.service) throw precondition('业务子内容的原父记录缺失');
        if (row.task !== null) facts.push(await task(row.task));
        else if (entry.task) throw precondition('业务内容缺少原任务标识');
        if (row.runtime !== null) {
          const runtime = await source('task', row.runtime); facts.push(runtime);
          if (row.old_runtime !== null && (await source('task', row.old_runtime, 'legacy')).digest !== runtime.digest)
            throw precondition('业务当前执行环境与历史标识不属于同一原对象');
        } else if (entry.table === 'cluster_commands' || row.old_runtime !== null) throw precondition('业务管理内容缺少原执行环境标识');
        const first = facts[0];
        if (!first || first.project === null || facts.some((value) => value.project !== first.project) || row.project !== null && ProjectIdSchema.parse(row.project) !== first.project)
          throw precondition('业务内容的原服务、任务或执行环境项目归属冲突');
        if (first.project === project) selected.push({ table: entry.table, key: row.key, digest: row.digest, ownership: jsonHash(facts) });
        counts[entry.table]!++; after = row.key;
      }
    });
    contents.push(...selected);
    if (selected.length) {
      const identity = jsonHash(selected), sourceIdentity = jsonHash(selected.map(({ key, ownership }) => ({ key, ownership })));
      resources.push({ kind: 'business-task-content', id: entry.table, identity, sourceIdentity, scope: 'metadata', count: selected.length });
    }
  }
  const inventory: ProjectDeletionInventory = { participant: 'business-task', complete: true, resources, references: [], blockers: [],
    revision: jsonHash({ project, resources, retained }) };
  return { inventory, contents, origins: [...origins.values()].sort((a, b) => Buffer.compare(Buffer.from(JSON.stringify([a.kind, a.key])), Buffer.from(JSON.stringify([b.kind, b.key])))),
    traversal: { complete: true as const, counts, digest: jsonHash({ project, contents }) } };
}

export function businessContentSnapshot(db: Database, sources: BusinessDeletionSources, projectId: ProjectId) {
  return db.transaction(async (tx) => { await tx.execute(sql`SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY`); return inspectBusinessContent(tx, sources, projectId); });
}
