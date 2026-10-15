// RFC-037 项目删除的 observability 参与方（RFC-034 v2 改写）：本模块的项目内容都直接带 project_id
// （告警、Agent 执行与其模型行、项目费用可见性），盘点、封写、删除与核对都是按项目的定向查询，不再全表扫描。
// 平台执行（档位测试，project_id 为空）与价格线不属于任何项目，保留。

import type { ProjectDeletionContext, ProjectDeletionTarget, ProjectId } from '@crewstation/contracts';
import { PROJECT_DELETION_PHASES, ProjectDeletionContextSchema, ProjectDeletionInventorySchema } from '@crewstation/contracts';
import { jsonHash, precondition } from '@crewstation/kernel';
import type { Database, Executor, Transaction } from '@crewstation/persistence';
import { withExclusiveDatabaseAdmission } from '@crewstation/persistence';
import { sql } from 'drizzle-orm';
import { z } from 'zod';
import type { ObservabilityDeletionRepository, ObservabilityProjectDirectory } from '../../ports/projectDeletion';

/** drizzle 把 JS 数组展开成参数元组而不是 PostgreSQL 数组，这里显式构造 `text[]`。 */
const projectKeysArray = (keys: readonly string[]) => sql`ARRAY[${sql.join(keys.map((key) => sql`${key}`), sql`, `)}]::text[]`;

/** 项目内容表与其行身份列；agent_call_models 随 agent_calls 级联删除，按执行行计。 */
const CONTENT: ReadonlyArray<{ readonly kind: string; readonly table: string; readonly id: string }> = [
  { kind: 'alerts', table: 'alerts', id: 'id' },
  { kind: 'agent_calls', table: 'agent_calls', id: 'id' },
  { kind: 'project_cost_visibility', table: 'project_cost_visibility', id: 'project_id' },
];
const admissionKey = (projectId: string) => 'observability.project:' + projectId;
const scopeSchema = z.object({ projectId: z.string().min(1), projectKeys: z.array(z.string().min(1)).min(1), targetHash: z.string().regex(/^[a-f0-9]{64}$/) }).strict();
type Scope = z.infer<typeof scopeSchema>;
type Fence = { project_id: string; operation_id: string; generation: number; revision: string; original: Scope; verified: boolean; phase_index: number; completed_count: number; completed_digest: string | null; stopped_count: number | null };
export interface ObservabilityDeletionInput {
  db: Database; identities: ObservabilityProjectDirectory;
  originalTarget?(id: ProjectId): Promise<ProjectDeletionTarget | undefined>;
  assertGrant(context: ProjectDeletionContext): Promise<void>;
}
type Input = ObservabilityDeletionInput;
const lockTimeout = (error: unknown): boolean => !!error && typeof error === 'object' && ('code' in error && error.code === '55P03' || 'cause' in error && lockTimeout(error.cause));
const targetIdentity = ({ state: _state, revision: _revision, ...identity }: ProjectDeletionTarget) => identity;

/** 每次普通写入在拿任务或价格行锁之前先进入项目准入。 */
export async function admitObservationWrite(tx: Transaction, projectId: string): Promise<void> {
  await tx.execute(sql`SELECT observability.admit_project(${projectId})`);
}

async function originalScope(input: Input, db: Executor, target: ProjectDeletionTarget): Promise<Scope> {
  const retained = (await db.execute<{ original: Scope }>(sql`SELECT original FROM observability.deletion_fences WHERE project_id=${target.id}`))[0]?.original;
  if (retained) {
    const scope = scopeSchema.parse(retained);
    if (scope.targetHash !== jsonHash(target)) {
      const original = await input.originalTarget?.(target.id);
      if (!original || scope.projectId !== original.id || scope.targetHash !== jsonHash(original) || jsonHash(targetIdentity(original)) !== jsonHash(targetIdentity(target)))
        throw precondition('观测清理的原项目身份发生变化');
    }
    // 已固定的范围里的旧项目标识每次仍要解析回同一项目：别名改指别处时阻断，而不是按旧范围宣告清空。
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

/** 盘点：每张内容表本项目的行数与行身份摘要（更新不改变身份，只有新增与删除会）。 */
async function inventory(db: Executor, scope: Scope) {
  const resources = [];
  let count = 0;
  for (const content of CONTENT) {
    const [row] = await db.execute<{ count: number; digest: string | null }>(sql`SELECT count(*)::int AS count,
      md5(string_agg(${sql.identifier(content.id)}::text, ',' ORDER BY ${sql.identifier(content.id)}::text)) AS digest
      FROM ${sql.identifier('observability')}.${sql.identifier(content.table)} WHERE project_id = ANY(${projectKeysArray(scope.projectKeys)})`);
    if (!row || row.count === 0) continue;
    count += row.count;
    resources.push({ kind: content.kind, id: content.kind, identity: jsonHash({ kind: content.kind, digest: row.digest, count: row.count }),
      sourceIdentity: jsonHash({ projectId: scope.projectId, kind: content.kind }), scope: 'metadata' as const, count: row.count });
  }
  const material = { participant: 'observability' as const, complete: true, resources, references: [], blockers: [] };
  return { inventory: ProjectDeletionInventorySchema.parse({ ...material, revision: jsonHash(material) }), count };
}

async function ownerTransaction<T>(input: Input, context: ProjectDeletionContext, scope: Scope, work: (tx: Transaction) => Promise<T>) {
  return withExclusiveDatabaseAdmission(input.db, admissionKey(scope.projectId), async (tx) => {
    for (const key of scope.projectKeys.filter((key) => key !== scope.projectId)) await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtextextended(${admissionKey(key)},0))`);
    await input.assertGrant(context);
    const result = await work(tx);
    await input.assertGrant(context);
    return result;
  });
}
async function authorize(input: Input, raw: ProjectDeletionContext): Promise<ProjectDeletionContext> {
  const context = ProjectDeletionContextSchema.parse(raw);
  const { revision, ...material } = context.confirmed;
  if (context.confirmed.participant !== 'observability' || !context.confirmed.complete || context.confirmed.blockers.length || revision !== jsonHash(material))
    throw precondition('观测清理原确认范围无效');
  await input.assertGrant(context);
  return context;
}
async function currentFence(db: Executor, context: ProjectDeletionContext): Promise<Fence | undefined> {
  const fence = (await db.execute<Fence>(sql`SELECT * FROM observability.deletion_fences WHERE project_id=${context.target.id}`))[0];
  if (fence && (fence.operation_id !== context.operationId || fence.generation > context.generation || fence.generation === context.generation && fence.revision !== context.confirmed.revision))
    throw precondition('观测清理操作、世代或原确认范围冲突');
  return fence;
}

async function seal(input: Input, raw: ProjectDeletionContext): Promise<boolean | 'waiting'> {
  const context = await authorize(input, raw), scope = await originalScope(input, input.db, context.target);
  if (context.phase !== 'seal') throw precondition('观测封闭只能在 seal 阶段执行');
  try {
    return await ownerTransaction(input, context, scope, async (tx) => {
      const previous = await currentFence(tx, context);
      if (previous?.generation === context.generation) return previous.verified;
      if (previous?.phase_index === 6) throw precondition('观测清理已经完成，不能重开');
      const current = await inventory(tx, scope), verified = current.inventory.revision === context.confirmed.revision;
      await tx.execute(sql`INSERT INTO observability.deletion_fences(project_id,operation_id,generation,revision,original,verified,phase_index,completed_count)
        VALUES(${scope.projectId},${context.operationId},${context.generation},${context.confirmed.revision},${JSON.stringify(scope)}::jsonb,${verified},-1,${current.count})
        ON CONFLICT(project_id) DO UPDATE SET generation=excluded.generation,revision=excluded.revision,verified=excluded.verified,phase_index=-1,completed_count=excluded.completed_count,stopped_count=NULL,stopped_revision=NULL`);
      return verified;
    });
  } catch (error) { if (lockTimeout(error)) return 'waiting'; throw error; }
}

async function step(input: Input, raw: ProjectDeletionContext): Promise<{ count: number; digest: string }> {
  const context = await authorize(input, raw), scope = await originalScope(input, input.db, context.target), index = PROJECT_DELETION_PHASES.indexOf(context.phase);
  return ownerTransaction(input, context, scope, async (tx) => {
    const fence = await currentFence(tx, context);
    if (!fence?.verified || fence.revision !== context.confirmed.revision) throw precondition('观测原范围尚未确认或世代已变化');
    if (fence.phase_index < index - 1 || fence.phase_index > index && context.phase !== 'metadata') throw precondition('观测清理需要原前序阶段，不能跳步');
    let stopped = fence.stopped_count;
    // 封写之后不再有新增：停止阶段固定待删范围，元数据阶段按它删除并核对。
    if (context.phase === 'stop' && fence.phase_index === 0) stopped = (await inventory(tx, scope)).count;
    if (context.phase === 'metadata' && fence.phase_index < 5) {
      if ((await inventory(tx, scope)).count !== stopped) throw precondition('观测原停止后的清理范围已经变化');
      for (const content of [...CONTENT].reverse())
        await tx.execute(sql`DELETE FROM ${sql.identifier('observability')}.${sql.identifier(content.table)} WHERE project_id = ANY(${projectKeysArray(scope.projectKeys)})`);
    }
    if (context.phase === 'verify' && (await inventory(tx, scope)).count !== 0) throw precondition('观测内容仍有残留');
    const count = context.phase === 'seal' ? fence.completed_count : ['stop', 'metadata', 'verify'].includes(context.phase) ? stopped ?? 0 : 0;
    const digest = fence.completed_digest && context.phase === 'verify' ? fence.completed_digest
      : jsonHash({ participant: 'observability', operationId: context.operationId, generation: fence.generation, phase: context.phase, count, remaining: 0 });
    if (fence.phase_index < index) await tx.execute(sql`UPDATE observability.deletion_fences SET phase_index=${index},stopped_count=${stopped},completed_digest=${context.phase === 'verify' ? digest : null} WHERE project_id=${scope.projectId}`);
    return { count, digest };
  });
}

export function observabilityDeletionRepository(input: Input): ObservabilityDeletionRepository {
  return {
    inspect: async (target) => {
      const scope = await originalScope(input, input.db, target);
      return input.db.transaction(async (tx) => (await inventory(tx, scope)).inventory, { isolationLevel: 'repeatable read', accessMode: 'read only' });
    },
    seal: (context) => seal(input, context),
    step: (context) => step(input, context),
  };
}
