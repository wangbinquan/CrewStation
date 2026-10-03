import type { ProjectDeletionContext, ProjectDeletionTarget } from '@crewstation/contracts';
import { PROJECT_DELETION_PHASES, ProjectDeletionContextSchema, ProjectDeletionInventorySchema } from '@crewstation/contracts';
import { jsonHash, precondition } from '@crewstation/kernel';
import type { Database, Executor, Transaction } from '@crewstation/persistence';
import { withExclusiveDatabaseAdmission } from '@crewstation/persistence';
import { sql } from 'drizzle-orm';
import { z } from 'zod';
import {runtimeReportAdmissionKey} from '../../ports/completeRuntimeReportCache';
import type { ObservabilityReportLifecycle, ObservabilityDeletionRepository, ObservabilityDeletionTasks, ObservabilityProjectDirectory } from '../../ports/projectDeletion';

const columns: Readonly<Record<string, readonly string[]>> = {
  runtime_report_clock:['revision','singleton'],
  runtime_report_revisions:['revision'],
  runtime_reports:['created_at','id','lease_until','manifest','owner','report','request','request_key','state'],
  runtime_report_pages:['digest','items_count','ordinal','previous_digest','report_id'],
  runtime_report_rows:['document','key','ordinal','parent','report_id','section'],
  runtime_report_counts:['parent','report_id','section','total'],
  runtime_report_receipts:['document','key','report_id'],
  accepted_execution_prices: ["document", "execution_id", "fingerprint", "generation"],
  alerts: ["detail", "fired_at", "id", "key", "project_id", "resolved_at", "state", "type"],
  cost_visibility: ["document", "project_id", "revision"],
  cost_visibility_receipts: ["document", "fingerprint", "project_id", "request_key"],
  development_model_evidence: ["document", "fingerprint", "meter_key", "revision"],
  execution_valuation_receipts: ["document", "fingerprint", "request_key", "task_key"],
  execution_valuations: ["basis_fingerprint", "document", "meter_key", "task_key"],
  native_baselines: ["capture_id", "document", "native_key", "ordinal", "owner_id", "status", "task_key"],
  native_capture_history: ["capture_id", "document", "sequence", "task_key"],
  native_captures: ["document", "finalized", "id", "lineage_key", "root", "source_id", "summary", "task_key", "turn"],
  native_repairs: ["active", "document", "meter_key", "native_key", "task_key", "valuation_key"],
  native_steps: ["capture_id", "fingerprint", "model_evidence", "native_key", "record_id", "revision", "root", "task_key"],
  resource_identity_aliases: ["id", "key", "kind"],
  token_price_heads: ["profile_id", "revision"],
  token_prices: ["condition", "document", "effective_from", "fingerprint", "id", "model", "profile_id", "profile_revision", "protocol", "provider", "request_key", "revision"],
  usage_changes: ["document", "meter_key", "sequence", "task_key"],
  usage_events: ["event_id", "fingerprint", "source_id", "task_key"],
  usage_evidence: ["document", "fingerprint", "meter_key", "revision"],
  usage_heads: ["project_id", "sequence", "task_id", "task_key"],
  usage_pages: ["cursor", "fingerprint", "source_id", "task_key"],
  usage_projections: ["document", "meter_key", "task_key"],
  usage_snapshots: ["created_at", "expires_at", "id", "task_key", "through", "visibility_revision"],
  usage_sources: ["cursor", "source_id", "task_key"],
  deletion_fences: ["project_id", "operation_id", "generation", "revision", "original", "verified", "phase_index", "completed_count", "completed_digest"],
  deletion_entities: ["kind", "entity_id", "project_id"],
};

const excluded = new Set(['token_prices', 'token_price_heads', 'resource_identity_aliases', 'deletion_fences', 'deletion_entities','runtime_report_clock','runtime_report_revisions','runtime_reports','runtime_report_pages','runtime_report_rows','runtime_report_counts','runtime_report_receipts']);
const contentTables = Object.keys(columns).filter((name) => !excluded.has(name));
const table = (name: string) => sql`${sql.identifier('observability')}.${sql.identifier(name)}`;
const admissionKey = (projectId: string) => 'observability.project:' + projectId;
const scopeSchema = z.object({ projectId: z.string().min(1), projectKeys: z.array(z.string().min(1)).min(1), targetHash: z.string().regex(/^[a-f0-9]{64}$/) }).strict();
type Scope = z.infer<typeof scopeSchema>;
type Entity = { kind: string; id: string };
type ContentRow = { table: string; tid: string; body: Record<string, unknown>; projects: string[]; entities: Entity[]; owners: Set<string> };
type Fence = { project_id: string; operation_id: string; generation: number; revision: string; original: Scope; verified: boolean; phase_index: number; completed_count: number; completed_digest: string | null };
interface Input {
  db: Database; identities: ObservabilityProjectDirectory; tasks?: ObservabilityDeletionTasks; reports?:ObservabilityReportLifecycle;
  assertGrant(context: ProjectDeletionContext): Promise<void>;
}
const lockTimeout = (error: unknown): boolean => !!error && typeof error === 'object' && ('code' in error && error.code === '55P03' || 'cause' in error && lockTimeout(error.cause));
const ownerKey = (entity: Entity) => JSON.stringify([entity.kind, entity.id]);
const normalized = (scope: Scope, projectId: string) => scope.projectKeys.includes(projectId) ? scope.projectId : projectId;

/** Every normal write enters before acquiring its task or pricing row locks. */
export async function admitObservationWrite(tx: Transaction, projectId: string): Promise<void> {
  await tx.execute(sql`SELECT observability.admit_project(${projectId})`);
}
async function knownColumns(db: Executor): Promise<void> {
  const found = await db.execute<{ table_name: string; column_name: string }>(sql`SELECT table_name,column_name FROM information_schema.columns WHERE table_schema='observability' ORDER BY table_name,column_name`);
  if (found.some((entry) => !columns[entry.table_name]?.includes(entry.column_name)) || Object.entries(columns).some(([name, expected]) => expected.some((column) => !found.some((entry) => entry.table_name === name && entry.column_name === column)))) {
    throw precondition('观测存在未知或缺失的内容表／列，不能证明完整清理');
  }
}
async function originalScope(input: Input, db: Executor, target: ProjectDeletionTarget): Promise<Scope> {
  const retained = (await db.execute<{ original: Scope }>(sql`SELECT original FROM observability.deletion_fences WHERE project_id=${target.id}`))[0]?.original;
  if (retained) {
    const scope = scopeSchema.parse(retained);
    if (scope.targetHash !== jsonHash(target)) throw precondition('观测清理的原项目身份发生变化');
    for (const key of scope.projectKeys.filter((key) => key !== target.id)) if (await input.identities.resolve('project', [key]) !== target.id) throw precondition('观测旧项目标识的原身份冲突');
    return scope;
  }
  const keys = [target.id as string];
  for (const alias of await input.identities.aliases('project', target.id)) {
    if (await input.identities.resolve('project', alias) !== target.id) throw precondition('观测旧项目标识的原身份冲突');
    if (alias.length === 1) keys.push(alias[0]!);
  }
  return { projectId: target.id, projectKeys: [...new Set(keys)].sort(), targetHash: jsonHash(target) };
}
async function contentRows(db: Executor, scope: Scope): Promise<ContentRow[]> {
  const result: ContentRow[] = [];
  for (const name of contentTables) {
    const rows = await db.execute<{ tid: string; body: Record<string, unknown>; projects: string[]; entities: Entity[] }>(sql`SELECT ctid::text AS tid,to_jsonb(${sql.identifier(name)}) AS body,
      observability.row_projects(to_jsonb(${sql.identifier(name)})) AS projects,observability.row_entities(${name},to_jsonb(${sql.identifier(name)})) AS entities FROM ${table(name)}`);
    result.push(...rows.map((row) => ({ ...row, table: name, owners: new Set(row.projects.map((id) => normalized(scope, id))) })));
  }
  return result;
}
function bindOwners(rows: ContentRow[], known: Map<string, Set<string>>): void {
  let changed = true;
  while (changed) {
    changed = false;
    for (const row of rows) {
      for (const entity of row.entities) for (const owner of known.get(ownerKey(entity)) ?? []) if (!row.owners.has(owner)) { row.owners.add(owner); changed = true; }
      for (const entity of row.entities) {
        const key = ownerKey(entity), owners = known.get(key) ?? new Set<string>();
        for (const owner of row.owners) if (!owners.has(owner)) { owners.add(owner); changed = true; }
        known.set(key, owners);
      }
    }
  }
}
async function scan(db: Executor, scope: Scope, tasks?: { ids: readonly string[]; complete: boolean }) {
  await knownColumns(db);
  const rows = await contentRows(db, scope), known = new Map<string, Set<string>>();
  const retained = await db.execute<{ kind: string; entity_id: string; project_id: string }>(sql`SELECT kind,entity_id,project_id FROM observability.deletion_entities`);
  for (const entity of retained) known.set(ownerKey({ kind: entity.kind, id: entity.entity_id }), new Set([normalized(scope, entity.project_id)]));
  if (tasks?.complete) for (const taskId of tasks.ids) {
    const keys = scope.projectKeys.map((projectId) => jsonHash({ projectId, taskId }));
    for (const entity of [...keys.map((id) => ({ kind: 'task-key', id })), { kind: 'task', id: taskId }]) {
      const key = ownerKey(entity), owners = known.get(key) ?? new Set<string>(); owners.add(scope.projectId); known.set(key, owners);
    }
    for (const row of rows) if (row.entities.some((entity) => entity.kind === 'task-key' && keys.includes(entity.id))) row.entities.push({ kind: 'task', id: taskId });
  }
  bindOwners(rows, known);
  const orphan = rows.some((row) => !row.owners.size), conflict = rows.some((row) => row.owners.size > 1);
  const badHead = rows.some((row) => row.table === 'usage_heads' && row.body.task_key !== jsonHash({ projectId: row.body.project_id, taskId: row.body.task_id }));
  const blockers = [
    ...(orphan ? [{ participant: 'observability' as const, code: 'observability-orphan', message: '存在无法核对原项目归属的观测内容，需完整历史任务来源' }] : []),
    ...(conflict || badHead ? [{ participant: 'observability' as const, code: 'observability-ownership-conflict', message: '观测内容的原项目、任务键或关联身份冲突' }] : []),
  ];
  const own = rows.filter((row) => row.owners.size === 1 && row.owners.has(scope.projectId));
  const resources = contentTables.flatMap((kind) => {
    const values = own.filter((row) => row.table === kind).map((row) => jsonHash(row.body)).sort();
    return values.length ? [{ kind, id: kind, identity: jsonHash(values), sourceIdentity: jsonHash({ projectId: scope.projectId, kind }), scope: 'metadata' as const, count: values.length }] : [];
  });
  const material = { participant: 'observability' as const, complete: !blockers.length, resources, references: [], blockers };
  return { inventory: ProjectDeletionInventorySchema.parse({ ...material, revision: jsonHash(material) }), own };
}
async function ownerTransaction<T>(input: Input, context: ProjectDeletionContext, scope: Scope, work: (tx: Transaction) => Promise<T>) {
  return withExclusiveDatabaseAdmission(input.db, admissionKey(scope.projectId), async (tx) => {
    for (const key of scope.projectKeys.filter((key) => key !== scope.projectId)) await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtextextended(${admissionKey(key)},0))`);
    await tx.execute(sql`SELECT set_config('crewstation.observability_deletion',${context.operationId + ':' + context.generation + ':' + context.phase},true)`);
    return work(tx);
  });
}
async function authorized(input: Input, raw: ProjectDeletionContext): Promise<ProjectDeletionContext> {
  const context = ProjectDeletionContextSchema.parse(raw);
  const { revision, ...material } = context.confirmed;
  if (context.confirmed.participant !== 'observability' || !context.confirmed.complete || context.confirmed.blockers.length || revision !== jsonHash(material)) {
    throw precondition('观测清理原确认范围无效');
  }
  await input.assertGrant(context); return context;
}
async function currentFence(db: Executor, context: ProjectDeletionContext): Promise<Fence | undefined> {
  const fence = (await db.execute<Fence>(sql`SELECT * FROM observability.deletion_fences WHERE project_id=${context.target.id}`))[0];
  if (fence && (fence.operation_id !== context.operationId || fence.generation > context.generation || fence.generation === context.generation && fence.revision !== context.confirmed.revision)) throw precondition('观测清理操作、世代或原确认范围冲突');
  return fence;
}
async function retainEntities(tx: Transaction, scope: Scope, rows: ContentRow[]): Promise<void> {
  const entities = new Map(rows.flatMap((row) => row.entities.map((entity) => [ownerKey(entity), entity] as const)));
  for (const entity of entities.values()) await tx.execute(sql`INSERT INTO observability.deletion_entities(kind,entity_id,project_id) VALUES(${entity.kind},${entity.id},${scope.projectId}) ON CONFLICT(kind,entity_id) DO NOTHING`);
}
async function clearReports(input:Input,tx:Transaction):Promise<boolean>{
  const [lock]=await tx.execute<{held:boolean}>(sql`SELECT pg_try_advisory_xact_lock(hashtextextended(${runtimeReportAdmissionKey},0)) AS held`);
  if(!lock?.held)return false;
  const [cache]=await tx.execute<{count:string}>(sql`SELECT count(*)::text AS count FROM observability.runtime_reports`);
  if(!input.reports&&cache?.count!=='0')throw precondition('派生报告的原物理清理 owner 尚未接入');
  await input.reports?.clear();
  await tx.execute(sql`DELETE FROM observability.runtime_reports`);
  const [remaining]=await tx.execute<{count:string}>(sql`SELECT count(*)::text AS count FROM observability.runtime_reports`);
  if(remaining?.count!=='0'||input.reports&&!(await input.reports.empty()))throw precondition('派生报告或原工作根仍有残留');
  return true;
}
async function quiesce<T>(input:Input,work:()=>Promise<T>):Promise<T>{return input.reports?input.reports.quiesce(work):work();}
async function seal(input:Input,raw:ProjectDeletionContext):Promise<boolean|'waiting'>{return quiesce(input,()=>sealQuiesced(input,raw));}
async function sealQuiesced(input: Input, raw: ProjectDeletionContext): Promise<boolean | 'waiting'> {
  const context = await authorized(input, raw), scope = await originalScope(input, input.db, context.target);
  const tasks = await input.tasks?.list(context.target);
  if (context.phase !== 'seal') throw precondition('观测封闭只能在 seal 阶段执行');
  try { return await ownerTransaction(input, context, scope, async (tx) => {
    if(!(await clearReports(input,tx)))return 'waiting' as const;
    const previous = await currentFence(tx, context);
    if (previous?.generation === context.generation) return previous.verified;
    if (previous?.phase_index === 6) throw precondition('观测清理已经完成，不能重开');
    const current = await scan(tx, scope, tasks), verified = current.inventory.complete && current.inventory.revision === context.confirmed.revision;
    if (current.inventory.complete) await retainEntities(tx, scope, current.own);
    const count = current.own.length;
    await tx.execute(sql`INSERT INTO observability.deletion_fences(project_id,operation_id,generation,revision,original,verified,phase_index,completed_count)
      VALUES(${scope.projectId},${context.operationId},${context.generation},${context.confirmed.revision},${JSON.stringify(scope)}::jsonb,${verified},-1,${count})
      ON CONFLICT(project_id) DO UPDATE SET generation=excluded.generation,revision=excluded.revision,verified=excluded.verified,phase_index=-1,completed_count=excluded.completed_count`);
    return verified;
  }); } catch (error) { if (lockTimeout(error)) return 'waiting'; throw error; }
}
async function erase(tx: Transaction, rows: ContentRow[]): Promise<void> {
  // ctid is used only within this locked transaction; the confirmed identity is the full row digest.
  for (const name of contentTables.filter((name) => name !== 'usage_heads').concat('usage_heads')) {
    const tids = rows.filter((row) => row.table === name).map((row) => row.tid);
    for (let i = 0; i < tids.length; i += 500) await tx.execute(sql`DELETE FROM ${table(name)} WHERE ctid IN (${sql.join(tids.slice(i, i + 500).map((tid) => sql`${tid}::tid`), sql`, `)})`);
  }
}
async function step(input:Input,raw:ProjectDeletionContext):Promise<{count:number;digest:string}|'waiting'>{return raw.phase==='verify'?quiesce(input,()=>stepQuiesced(input,raw)):stepQuiesced(input,raw);}
async function stepQuiesced(input: Input, raw: ProjectDeletionContext): Promise<{ count: number; digest: string }|'waiting'> {
  const context = await authorized(input, raw), scope = await originalScope(input, input.db, context.target), index = PROJECT_DELETION_PHASES.indexOf(context.phase);
  const tasks = await input.tasks?.list(context.target);
  const work=()=>ownerTransaction(input, context, scope, async (tx) => {
    const fence = await currentFence(tx, context);
    if (!fence?.verified || fence.generation !== context.generation) throw precondition('观测原范围尚未确认或世代已变化');
    if (fence.phase_index < index - 1 || fence.phase_index > index && context.phase !== 'metadata') throw precondition('观测清理需要原前序阶段，不能跳步');
    if(context.phase==='verify'&&!(await clearReports(input,tx)))return 'waiting' as const;
    if (context.phase === 'metadata' && fence.phase_index < 5) {
      const current = await scan(tx, scope, tasks);
      if (!current.inventory.complete || current.inventory.revision !== context.confirmed.revision) throw precondition('观测原清理范围已经变化');
      await erase(tx, current.own);
    }
    if (context.phase === 'verify') {
      const current = await scan(tx, scope, tasks);
      if (!current.inventory.complete || current.own.length) throw precondition('观测内容仍有残留或来源不完整');
    }
    const count = ['seal', 'metadata', 'verify'].includes(context.phase) ? fence.completed_count : 0;
    const digest = fence.completed_digest && context.phase === 'verify' ? fence.completed_digest : jsonHash({ participant: 'observability', operationId: context.operationId, generation: context.generation, phase: context.phase, count, remaining: 0 });
    if (fence.phase_index < index) await tx.execute(sql`UPDATE observability.deletion_fences SET phase_index=${index},completed_digest=${context.phase === 'verify' ? digest : null} WHERE project_id=${scope.projectId}`);
    return { count, digest };
  });
  return work();
}
export function observabilityDeletionRepository(input: Input): ObservabilityDeletionRepository {
  return {
    inspect: async (target) => {
      // Public directories can use the same one-connection base pool. Read them before opening our transaction.
      const scope = await originalScope(input, input.db, target), tasks = await input.tasks?.list(target);
      return input.db.transaction(async (tx) => (await scan(tx, scope, tasks)).inventory, { isolationLevel: 'repeatable read', accessMode: 'read only' });
    },
    seal: (context) => seal(input, context), step: (context) => step(input, context),
  };
}
