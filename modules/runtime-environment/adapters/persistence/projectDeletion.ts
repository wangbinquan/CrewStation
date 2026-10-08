import type { ProjectDeletionContext, ProjectDeletionEvidence, ProjectDeletionTarget } from '@crewstation/contracts';
import { PROJECT_DELETION_PHASES, ProjectDeletionContextSchema, ProjectDeletionEvidenceSchema, ProjectDeletionInventorySchema, ProjectIdSchema, ResourceIdSchema } from '@crewstation/contracts';
import { jsonHash, precondition } from '@crewstation/kernel';
import type { Database, Executor, Transaction } from '@crewstation/persistence';
import { withExclusiveDatabaseAdmission } from '@crewstation/persistence';
import { sql } from 'drizzle-orm';
import { z } from 'zod';
import { RuntimeImageCallbackRecordSchema, RuntimeImagePhysicalScopeSchema, runtimeImageCallbackReceipt, runtimeImagePhysicalBindings } from '../../domain/records';
import type { RuntimeImageDeletionRepository, RuntimeImageDeletionScope, RuntimeImageDeletionStored } from '../../ports/projectDeletion';
import { runtimeImageAdmissionKey } from './unitOfWork';
import { runtimeImageCallbackContent, runtimeImageContentRowKey, runtimeImageProjectContent } from './lifecycleRepositories';

const contentTables = ['references', 'validations', 'build_logs', 'builds', 'development_policies', 'project_image_policies', 'image_project_grants', 'creation_requests', 'allocation_receipts', 'deletion_callbacks'] as const;
const hash = z.string().regex(/^[a-f0-9]{64}$/);
const contentSchema = z.object({ inventory: ProjectDeletionInventorySchema,
  rows: z.array(z.object({ table: z.enum(contentTables), key: z.string().min(1), identity: hash }).strict()),
  consumers: z.array(z.object({ kind: z.enum(['build', 'validation']), id: ResourceIdSchema, state: z.string().min(1), identity: hash,
    resourceId: ResourceIdSchema.optional(), executionEpoch: z.number().int().positive().optional(), podUid: z.string().min(1).optional(), planIdentity: hash.optional() }).strict()),
  callbacks: z.array(RuntimeImageCallbackRecordSchema), dependencies: z.array(z.object({ kind: z.enum(['source', 'initializer']), revisionId: ResourceIdSchema, imageId: ResourceIdSchema }).strict()),
  artifacts: z.array(z.strictObject({ kind: z.enum(['build', 'version']), id: ResourceIdSchema, repository: z.string().min(1).max(512), digest: z.string().regex(/^sha256:[a-f0-9]{64}$/).optional(), projectOwned: z.boolean() })).optional() }).strict();
const storedSchema = z.object({ version: z.literal(1), target: z.object({ projectId: ProjectIdSchema, namespace: z.string().min(1), serviceId: ResourceIdSchema.optional() }).strict(),
  inventory: ProjectDeletionInventorySchema, content: contentSchema, physical: RuntimeImagePhysicalScopeSchema.nullable() }).strict();
type Fence = { operation_id: string; generation: number; revision: string; original: RuntimeImageDeletionScope; scope_verified: boolean; phase_index: number; receipts: RuntimeImageDeletionStored['receipts'] };
type Input = { db: Database; assertGrant(context: ProjectDeletionContext): Promise<void> };
const targetIdentity = (target: ProjectDeletionTarget) => ({ projectId: target.id, namespace: target.namespace, ...(target.serviceId ? { serviceId: target.serviceId } : {}) });
const lockUnavailable = (error: unknown): boolean => !!error && typeof error === 'object' && ('code' in error && error.code === '55P03' || 'cause' in error && lockUnavailable(error.cause));
function parsedScope(raw: unknown, target: ProjectDeletionTarget): RuntimeImageDeletionScope {
  const scope = storedSchema.parse(raw) as RuntimeImageDeletionScope;
  if (jsonHash(scope.target) !== jsonHash(targetIdentity(target)) || scope.inventory.participant !== 'runtime-environment' || scope.content.inventory.participant !== 'runtime-environment') throw precondition('运行镜像原范围不属于本项目');
  if (scope.physical && !runtimeImagePhysicalBindings(scope.physical, target.id, scope.content.inventory.resources, scope.content.callbacks)) throw precondition('运行镜像物理来源与原消费者范围不符');
  return scope;
}
async function permission(input: Input, raw: ProjectDeletionContext): Promise<ProjectDeletionContext> {
  const context = ProjectDeletionContextSchema.parse(raw);
  if (context.confirmed.participant !== 'runtime-environment' || !context.confirmed.complete || context.confirmed.blockers.length || context.confirmed.references.length) throw precondition('运行镜像清理许可未完整确认');
  await input.assertGrant(context); return context;
}
async function original(tx: Executor, context: ProjectDeletionContext): Promise<Fence> {
  const row = (await tx.execute<Fence>(sql`SELECT operation_id,generation,revision,original,scope_verified,phase_index,receipts FROM runtime_environment.deletion_fences WHERE project_id=${context.target.id} FOR UPDATE`))[0];
  if (!row || row.operation_id !== context.operationId || row.generation > context.generation || row.revision !== context.confirmed.revision) throw precondition('运行镜像原操作、世代或确认修订已变化');
  row.original = parsedScope(row.original, context.target);
  row.receipts = z.partialRecord(z.enum(PROJECT_DELETION_PHASES), ProjectDeletionEvidenceSchema).parse(row.receipts);
  return row;
}
function predecessor(row: Fence, context: ProjectDeletionContext) {
  if (!row.scope_verified || row.phase_index !== PROJECT_DELETION_PHASES.indexOf(context.phase) - 1) throw precondition('运行镜像清理缺少前一阶段或完整原范围');
}
async function record(tx: Transaction, row: Fence, context: ProjectDeletionContext, raw: ProjectDeletionEvidence) {
  const evidence = ProjectDeletionEvidenceSchema.parse(raw), old = row.receipts[context.phase];
  if (old) { if (jsonHash(old) !== jsonHash(evidence)) throw precondition('运行镜像阶段不能替换原回执'); return; }
  predecessor(row, context);
  await tx.execute(sql`UPDATE runtime_environment.deletion_fences SET phase_index=${PROJECT_DELETION_PHASES.indexOf(context.phase)},receipts=receipts||${JSON.stringify({ [context.phase]: evidence })}::jsonb WHERE project_id=${context.target.id}`);
}
async function tableRows(tx: Executor, name: typeof contentTables[number], projectId: string, keys: readonly string[]) {
  const table = sql`${sql.identifier('runtime_environment')}.${sql.identifier(name)}`;
  const supplied = sql`SELECT jsonb_array_elements_text(${JSON.stringify(keys)}::jsonb)`;
  const predicate = name === 'creation_requests' ? sql`request_scope=${projectId}` : name === 'image_project_grants' ? sql`project_id=${projectId}`
    : ['development_policies', 'project_image_policies'].includes(name) ? sql`project_id IN (${supplied})` : name === 'allocation_receipts' ? sql`operation_id IN (${supplied})`
    : name === 'build_logs' ? sql`sequence IN (SELECT jsonb_array_elements_text(${JSON.stringify(keys)}::jsonb)::bigint)` : sql`id IN (${supplied})`;
  return tx.execute<{ locator: string; body: Record<string, unknown>; entity_key: string }>(sql`SELECT ctid::text AS locator,to_jsonb(content) AS body,runtime_environment.deletion_key(${name},to_jsonb(content)) AS entity_key FROM ${table} AS content WHERE ${predicate} ORDER BY ctid FOR UPDATE`);
}
function sameContent(before: RuntimeImageDeletionScope['content'], current: RuntimeImageDeletionScope['content']) {
  const rows = (content: typeof before) => content.rows.filter((row) => row.table !== 'deletion_callbacks').map((row) => ({ ...row })).sort((a, b) => (a.table + ':' + a.key).localeCompare(b.table + ':' + b.key));
  if (!current.inventory.complete || jsonHash(rows(before)) !== jsonHash(rows(current))) throw precondition('已封闭的运行镜像内容变化，保留原范围重新核对');
  const old = before.callbacks.map((entry) => runtimeImageCallbackReceipt(entry)).sort(), actual = current.callbacks.map((entry) => runtimeImageCallbackReceipt(entry)).sort();
  if (jsonHash(old) !== jsonHash(actual) || current.callbacks.some((entry) => !entry.exited)) throw precondition('原运行镜像回调缺失、变化或未实际退出');
}
async function purgeRows(tx: Transaction, scope: RuntimeImageDeletionScope): Promise<number> {
  let count = 0;
  for (const name of contentTables) {
    const expected = scope.content.rows.filter((entry) => entry.table === name), byKey = new Map(expected.map((entry) => [entry.key, entry.identity]));
    if (!expected.length) continue;
    const rows = await tableRows(tx, name, scope.target.projectId, expected.map((entry) => entry.key)), table = sql`${sql.identifier('runtime_environment')}.${sql.identifier(name)}`;
    if (rows.length !== expected.length) throw precondition('运行镜像原内容记录缺失，不能盲删同名对象');
    for (const row of rows) {
      const key = runtimeImageContentRowKey({ table: name, body: row.body });
      if (!byKey.has(key) || name !== 'deletion_callbacks' && byKey.get(key) !== jsonHash(row.body)) throw precondition('运行镜像记录与原确认内容不匹配');
    }
    await tx.execute(sql`INSERT INTO runtime_environment.deletion_entities(kind,entity_key,project_id)
      SELECT ${name},jsonb_array_elements_text(${JSON.stringify(rows.map((row) => row.entity_key))}::jsonb),${scope.target.projectId} ON CONFLICT DO NOTHING`);
    if (name !== 'deletion_callbacks') {
      await tx.execute(sql`DELETE FROM ${table} WHERE ctid IN (SELECT jsonb_array_elements_text(${JSON.stringify(rows.map((row) => row.locator))}::jsonb)::tid)`);
      count += rows.length; continue;
    }
    for (const row of rows) {
      const remaining = name === 'deletion_callbacks' ? (row.body.project_ids as string[]).filter((id) => id !== scope.target.projectId) : [];
      if (remaining.length) await tx.execute(sql`UPDATE ${table} SET project_ids=${JSON.stringify(remaining)}::jsonb WHERE ctid=${row.locator}::tid`);
      else await tx.execute(sql`DELETE FROM ${table} WHERE ctid=${row.locator}::tid`);
      count++;
    }
  }
  return count;
}

export function runtimeImageDeletionRepository(input: Input): RuntimeImageDeletionRepository {
  const admitted = async <T>(raw: ProjectDeletionContext, work: (tx: Transaction, row: Fence, context: ProjectDeletionContext) => Promise<T>): Promise<T> => {
    const context = await permission(input, raw);
    return withExclusiveDatabaseAdmission(input.db, runtimeImageAdmissionKey(context.target.id), async (tx) => {
      await input.assertGrant(context);
      const row = await original(tx, context);
      // The current global lease authorizes this call; SQL keeps the original seal binding.
      await tx.execute(sql`SELECT set_config('crewstation.runtime_deletion_owner',${context.operationId + ':' + row.generation + ':' + context.phase},true)`);
      const result = await work(tx, row, context); await input.assertGrant(context); return result;
    });
  };
  return {
    content: (target) => input.db.transaction((tx) => runtimeImageProjectContent(tx, target.id), { isolationLevel: 'repeatable read', accessMode: 'read only' }),
    retained: async (target) => {
      const row = (await input.db.execute<{ original: unknown }>(sql`SELECT original FROM runtime_environment.deletion_fences WHERE project_id=${target.id}`))[0];
      return row ? parsedScope(row.original, target) : undefined;
    },
    seal: async (raw, supplied) => {
      const context = await permission(input, raw), scope = parsedScope(supplied, context.target);
      if (context.phase !== 'seal') throw precondition('运行镜像只能在 seal 阶段封闭准入');
      try { return await withExclusiveDatabaseAdmission(input.db, runtimeImageAdmissionKey(context.target.id), async (tx) => {
        await input.assertGrant(context);
        await tx.execute(sql`SELECT set_config('crewstation.runtime_deletion_owner',${context.operationId + ':' + context.generation + ':seal'},true)`);
        const old = (await tx.execute<Fence>(sql`SELECT * FROM runtime_environment.deletion_fences WHERE project_id=${context.target.id} FOR UPDATE`))[0];
        if (old && (old.operation_id !== context.operationId || old.generation > context.generation || old.phase_index >= 5 || old.generation === context.generation && old.revision !== context.confirmed.revision)) throw precondition('运行镜像不能替换原操作或已完成的清理');
        if (old && old.generation === context.generation) return old.scope_verified;
        const retained = old && parsedScope(old.original, context.target).physical;
        if (old && (retained || old.scope_verified) && jsonHash(retained) !== jsonHash(scope.physical)) throw precondition('运行镜像新世代不能替换原物理身份');
        const current = await runtimeImageProjectContent(tx, context.target.id), verified = scope.inventory.complete && scope.inventory.revision === context.confirmed.revision && current.inventory.revision === scope.content.inventory.revision && scope.physical !== null;
        await tx.execute(sql`INSERT INTO runtime_environment.deletion_fences(project_id,operation_id,generation,revision,original,scope_verified)
          VALUES(${context.target.id},${context.operationId},${context.generation},${context.confirmed.revision},${JSON.stringify(scope)}::jsonb,${verified})
          ON CONFLICT(project_id) DO UPDATE SET generation=EXCLUDED.generation,revision=EXCLUDED.revision,original=EXCLUDED.original,scope_verified=EXCLUDED.scope_verified,phase_index=-1,receipts='{}'::jsonb`);
        await input.assertGrant(context); return verified;
      }); } catch (error) { if (lockUnavailable(error)) return 'waiting'; throw error; }
    },
    load: (context) => admitted(context, async (_tx, row) => ({ scope: row.original, verified: row.scope_verified, phaseIndex: row.phase_index, receipts: row.receipts })),
    callbacksExited: (context) => admitted(context, async (tx, row) => {
      predecessor(row, context);
      const current = await runtimeImageProjectContent(tx, context.target.id);
      return current.inventory.complete && row.original.content.callbacks.every((entry) => current.callbacks.some((value) => value.id === entry.id && value.exited && runtimeImageCallbackReceipt(value) === runtimeImageCallbackReceipt(entry)));
    }),
    recoverCallbacks: (context, proof) => admitted(context, async (tx, row) => {
      if (context.phase !== 'stop') throw precondition('原回调只能在停止阶段恢复'); predecessor(row, context);
      if (!row.original.physical || !hash.safeParse(proof.digest).success || new Set(proof.callbackExits.map((entry) => entry.id)).size !== proof.callbackExits.length || !proof.independent || !proof.producersClosed || !proof.consumersStopped || proof.nativeRemaining !== 0 || proof.scopeDigest !== jsonHash(row.original.physical) || proof.sourceIdentity !== row.original.physical.source.identity) throw precondition('缺少原运行镜像回调独立停止证明');
      for (const exit of proof.callbackExits) {
        const birth = row.original.content.callbacks.find((entry) => entry.id === exit.id);
        if (!birth || exit.originalIdentity !== runtimeImageCallbackReceipt(birth) || !hash.safeParse(exit.digest).success) throw precondition('回调恢复不能使用其他原进程或输入身份');
        const existing = (await tx.execute<{ body: Record<string, unknown> }>(sql`SELECT to_jsonb(callback) AS body FROM runtime_environment.deletion_callbacks AS callback WHERE id=${exit.id} FOR UPDATE`))[0];
        if (!existing) throw precondition('原回调记录已丢失，不能补造退出');
        const current = runtimeImageCallbackContent(existing.body);
        if (!current.success || !current.data.projectIds.includes(context.target.id) || runtimeImageCallbackReceipt(current.data) !== runtimeImageCallbackReceipt(birth)) throw precondition('原回调行的进程或所属关系已变化');
        if (current.data.exited) continue;
        const recovery = jsonHash({ proof: proof.digest, scope: proof.scopeDigest, exit: exit.digest });
        await tx.execute(sql`UPDATE runtime_environment.deletion_callbacks SET exited_at=now(),recovery_digest=${recovery},exit_digest=${runtimeImageCallbackReceipt(birth, recovery)} WHERE id=${exit.id}`);
      }
    }),
    advance: (context, evidence) => admitted(context, async (tx, row) => {
      if (context.phase === 'metadata') throw precondition('元数据回执必须与实际清理同事务');
      if (context.phase === 'verify') {
        const current = await runtimeImageProjectContent(tx, context.target.id);
        if (!current.inventory.complete || current.rows.length) throw precondition('运行镜像内容仍有残留或来源不完整');
      }
      await record(tx, row, context, evidence);
    }),
    purgeMetadata: (context) => admitted(context, async (tx, row) => {
      if (context.phase !== 'metadata') throw precondition('运行镜像内容只能在 metadata 清理');
      if (row.receipts.metadata) return row.receipts.metadata;
      predecessor(row, context); const current = await runtimeImageProjectContent(tx, context.target.id); sameContent(row.original.content, current);
      const count = await purgeRows(tx, row.original), evidence: ProjectDeletionEvidence = { kind: 'metadata', count, digest: jsonHash({ operationId: context.operationId, revision: context.confirmed.revision, metadataPurged: true, count }), description: '本项目运行环境内容清理，平台目录和其他项目的内容保留' };
      const after = await runtimeImageProjectContent(tx, context.target.id);
      if (!after.inventory.complete || after.rows.length) throw precondition('运行镜像内容未清空或来源不完整，清理回滚');
      await record(tx, row, context, evidence); return evidence;
    }),
  };
}
