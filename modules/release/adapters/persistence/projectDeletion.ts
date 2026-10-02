import type { ProjectDeletionContext, ProjectDeletionEvidence, ProjectDeletionTarget } from '@crewstation/contracts';
import { PROJECT_DELETION_PHASES, ProjectDeletionContextSchema, ProjectDeletionEvidenceSchema } from '@crewstation/contracts';
import { jsonHash, precondition } from '@crewstation/kernel';
import type { Database, Executor, Transaction } from '@crewstation/persistence';
import { withExclusiveDatabaseAdmission } from '@crewstation/persistence';
import { sql } from 'drizzle-orm';
import { z } from 'zod';
import { ReleaseDeletionScopeSchema, releaseCallbackIdentity, releasePhysicalBindings } from '../../domain/release';
import type { ReleaseDeletionScope } from '../../domain/release';
import type { ReleaseDeletionRepository, ReleaseDeletionStored } from '../../ports/unitOfWork';
import type { ReleaseContentDirectory } from '../../ports/repositories';
import type { ServiceResolver } from '../../ports/platform';
import { releaseAdmissionKey } from './drizzleUnitOfWork';
import { releaseCallbackContent, releaseContentRowKey, releaseContentOver } from './projectContent';

const contentTables = ['traffic_switches', 'replica_overrides', 'slot_maintenance', 'slot_events', 'execution_handoffs', 'service_slots', 'deletion_callbacks', 'releases'] as const;
const hash = z.string().regex(/^[a-f0-9]{64}$/);

type Fence = { operation_id: string; generation: number; revision: string; original: ReleaseDeletionScope; scope_verified: boolean; phase_index: number; receipts: ReleaseDeletionStored['receipts'] };
type Input = { db: Database; services: ServiceResolver; identities?: ReleaseContentDirectory; assertGrant(context: ProjectDeletionContext): Promise<void> };
const targetIdentity = (target: ProjectDeletionTarget) => ({ projectId: target.id, namespace: target.namespace, ...(target.serviceId ? { serviceId: target.serviceId } : {}) });
const lockUnavailable = (error: unknown): boolean => !!error && typeof error === 'object' && ('code' in error && error.code === '55P03' || 'cause' in error && lockUnavailable(error.cause));
function parsedScope(raw: unknown, target: ProjectDeletionTarget): ReleaseDeletionScope {
  const scope = ReleaseDeletionScopeSchema.parse(raw);
  if (jsonHash(scope.target) !== jsonHash(targetIdentity(target)) || scope.inventory.participant !== 'release' || scope.content.inventory.participant !== 'release') throw precondition('发布原范围不属于本项目');
  if (scope.physical && !releasePhysicalBindings(scope.content, scope.physical)) throw precondition('发布物理来源与原消费者范围不符');
  return scope;
}
async function permission(input: Input, raw: ProjectDeletionContext): Promise<ProjectDeletionContext> {
  const context = ProjectDeletionContextSchema.parse(raw);
  if (context.confirmed.participant !== 'release' || !context.confirmed.complete || context.confirmed.blockers.length || context.confirmed.references.length) throw precondition('发布清理许可未完整确认');
  await input.assertGrant(context); return context;
}
async function original(tx: Executor, context: ProjectDeletionContext): Promise<Fence> {
  const row = (await tx.execute<Fence>(sql`SELECT operation_id,generation,revision,original,scope_verified,phase_index,receipts FROM release.deletion_fences WHERE project_id=${context.target.id} FOR UPDATE`))[0];
  if (!row || row.operation_id !== context.operationId || row.generation !== context.generation || row.revision !== context.confirmed.revision) throw precondition('发布原操作、世代或确认修订已变化');
  row.original = parsedScope(row.original, context.target);
  row.receipts = z.partialRecord(z.enum(PROJECT_DELETION_PHASES), ProjectDeletionEvidenceSchema).parse(row.receipts);
  return row;
}
function predecessor(row: Fence, context: ProjectDeletionContext) {
  if (!row.scope_verified || row.phase_index !== PROJECT_DELETION_PHASES.indexOf(context.phase) - 1) throw precondition('发布清理缺少前一阶段或完整原范围');
}
async function record(tx: Transaction, row: Fence, context: ProjectDeletionContext, raw: ProjectDeletionEvidence) {
  const evidence = ProjectDeletionEvidenceSchema.parse(raw), old = row.receipts[context.phase];
  if (old) { if (jsonHash(old) !== jsonHash(evidence)) throw precondition('发布阶段不能替换原回执'); return; }
  predecessor(row, context);
  await tx.execute(sql`UPDATE release.deletion_fences SET phase_index=${PROJECT_DELETION_PHASES.indexOf(context.phase)},receipts=receipts||${JSON.stringify({ [context.phase]: evidence })}::jsonb WHERE project_id=${context.target.id}`);
}
async function tableRows(tx: Executor, name: typeof contentTables[number], keys: readonly string[]) {
  const table = sql`${sql.identifier('release')}.${sql.identifier(name)}`;
  return tx.execute<{ locator: string; body: Record<string, unknown>; entity_key: string }>(sql`SELECT ctid::text AS locator,to_jsonb(content) AS body,release.deletion_key(${name},to_jsonb(content)) AS entity_key
    FROM ${table} AS content WHERE release.deletion_key(${name},to_jsonb(content)) IN (SELECT jsonb_array_elements_text(${JSON.stringify(keys)}::jsonb)) ORDER BY ctid FOR UPDATE`);
}
function sameContent(before: ReleaseDeletionScope['content'], current: ReleaseDeletionScope['content']) {
  const rows = (content: typeof before) => content.rows.filter((row) => row.table !== 'deletion_callbacks').map((row) => ({ ...row })).sort((a, b) => (a.table + ':' + a.key).localeCompare(b.table + ':' + b.key));
  if (!current.inventory.complete || jsonHash(rows(before)) !== jsonHash(rows(current))) throw precondition('已封闭的发布内容变化，保留原范围重新核对');
  const old = before.callbacks.map((entry) => releaseCallbackIdentity(entry)).sort(), actual = current.callbacks.map((entry) => releaseCallbackIdentity(entry)).sort();
  if (jsonHash(old) !== jsonHash(actual) || current.callbacks.some((entry) => !entry.exited)) throw precondition('原发布回调缺失、变化或未实际退出');
}
async function purgeRows(tx: Transaction, scope: ReleaseDeletionScope): Promise<number> {
  let count = 0;
  for (const name of contentTables) {
    const expected = scope.content.rows.filter((entry) => entry.table === name), byKey = new Map(expected.map((entry) => [entry.key, entry.identity]));
    if (!expected.length) continue;
    const rows = await tableRows(tx, name, expected.map((entry) => entry.key)), table = sql`${sql.identifier('release')}.${sql.identifier(name)}`;
    if (rows.length !== expected.length) throw precondition('发布原内容记录缺失，不能盲删同名对象');
    for (const row of rows) {
      const key = releaseContentRowKey(name, row.body);
      if (!byKey.has(key) || name !== 'deletion_callbacks' && byKey.get(key) !== jsonHash(row.body)) throw precondition('发布记录与原确认内容不匹配');
    }
    await tx.execute(sql`INSERT INTO release.deletion_entities(kind,entity_key,project_id)
      SELECT ${name},jsonb_array_elements_text(${JSON.stringify(rows.map((row) => row.entity_key))}::jsonb),${scope.target.projectId} ON CONFLICT DO NOTHING`);
    await tx.execute(sql`DELETE FROM ${table} WHERE ctid IN (SELECT jsonb_array_elements_text(${JSON.stringify(rows.map((row) => row.locator))}::jsonb)::tid)`);
    count += rows.length;
  }
  const services = [...new Set([...(scope.target.serviceId ? [scope.target.serviceId] : []), ...scope.content.consumers.map((entry) => entry.serviceId)])];
  const releases = scope.content.consumers.filter((entry) => entry.kind === 'release').flatMap((entry) => entry.aliases);
  for (const [kind, keys] of [['service', services], ['release', releases]] as const) {
    await tx.execute(sql`INSERT INTO release.deletion_entities(kind,entity_key,project_id)
      SELECT ${kind},jsonb_array_elements_text(${JSON.stringify(keys)}::jsonb),${scope.target.projectId} ON CONFLICT DO NOTHING`);
  }
  return count;
}

export function releaseDeletionRepository(input: Input): ReleaseDeletionRepository {
  const admitted = async <T>(raw: ProjectDeletionContext, work: (tx: Transaction, row: Fence, context: ProjectDeletionContext) => Promise<T>): Promise<T> => {
    const context = await permission(input, raw);
    return withExclusiveDatabaseAdmission(input.db, releaseAdmissionKey(context.target.id), async (tx) => {
      await input.assertGrant(context);
      await tx.execute(sql`SELECT set_config('crewstation.release_deletion_owner',${context.operationId + ':' + context.generation + ':' + context.phase},true)`);
      const result = await work(tx, await original(tx, context), context); await input.assertGrant(context); return result;
    });
  };
  return {
    content: (target) => input.db.transaction((tx) => releaseContentOver(tx, input, target), { isolationLevel: 'repeatable read', accessMode: 'read only' }),
    retained: async (target) => {
      const row = (await input.db.execute<{ original: unknown }>(sql`SELECT original FROM release.deletion_fences WHERE project_id=${target.id}`))[0];
      return row ? parsedScope(row.original, target) : undefined;
    },
    seal: async (raw, supplied) => {
      const context = await permission(input, raw), scope = parsedScope(supplied, context.target);
      if (context.phase !== 'seal') throw precondition('发布只能在 seal 阶段封闭准入');
      try { return await withExclusiveDatabaseAdmission(input.db, releaseAdmissionKey(context.target.id), async (tx) => {
        await input.assertGrant(context);
        await tx.execute(sql`SELECT set_config('crewstation.release_deletion_owner',${context.operationId + ':' + context.generation + ':seal'},true)`);
        const old = (await tx.execute<Fence>(sql`SELECT * FROM release.deletion_fences WHERE project_id=${context.target.id} FOR UPDATE`))[0];
        if (old && (old.operation_id !== context.operationId || old.generation > context.generation || old.phase_index >= 5 || old.generation === context.generation && old.revision !== context.confirmed.revision)) throw precondition('发布不能替换原操作或已完成的清理');
        if (old && old.generation === context.generation) return old.scope_verified;
        const retained = old && parsedScope(old.original, context.target).physical;
        if (old && (retained || old.scope_verified) && jsonHash(retained) !== jsonHash(scope.physical)) throw precondition('发布新世代不能替换原物理身份');
        const current = await releaseContentOver(tx, input, context.target), verified = scope.inventory.complete && scope.inventory.revision === context.confirmed.revision && current.inventory.revision === scope.content.inventory.revision && scope.physical !== null;
        await tx.execute(sql`INSERT INTO release.deletion_fences(project_id,operation_id,generation,revision,original,scope_verified)
          VALUES(${context.target.id},${context.operationId},${context.generation},${context.confirmed.revision},${JSON.stringify(scope)}::jsonb,${verified})
          ON CONFLICT(project_id) DO UPDATE SET generation=EXCLUDED.generation,revision=EXCLUDED.revision,original=EXCLUDED.original,scope_verified=EXCLUDED.scope_verified,phase_index=-1,receipts='{}'::jsonb`);
        await input.assertGrant(context); return verified;
      }); } catch (error) { if (lockUnavailable(error)) return 'waiting'; throw error; }
    },
    load: (context) => admitted(context, async (_tx, row) => ({ scope: row.original, verified: row.scope_verified, phaseIndex: row.phase_index, receipts: row.receipts })),
    callbacksExited: (context) => admitted(context, async (tx, row) => {
      predecessor(row, context);
      const current = await releaseContentOver(tx, input, context.target);
      return current.inventory.complete && row.original.content.callbacks.every((entry) => current.callbacks.some((value) => value.id === entry.id && value.exited && releaseCallbackIdentity(value) === releaseCallbackIdentity(entry)));
    }),
    recoverCallbacks: (context, proof) => admitted(context, async (tx, row) => {
      if (context.phase !== 'stop') throw precondition('原回调只能在停止阶段恢复'); predecessor(row, context);
      if (!row.original.physical || !hash.safeParse(proof.digest).success || new Set(proof.callbackExits.map((entry) => entry.id)).size !== proof.callbackExits.length || !proof.independent || !proof.producersClosed || !proof.consumersStopped || proof.nativeRemaining !== 0 || proof.scopeDigest !== jsonHash(row.original.physical) || proof.sourceIdentity !== row.original.physical.source.identity) throw precondition('缺少原发布回调独立停止证明');
      for (const exit of proof.callbackExits) {
        const birth = row.original.content.callbacks.find((entry) => entry.id === exit.id);
        if (!birth || exit.originalIdentity !== releaseCallbackIdentity(birth) || !hash.safeParse(exit.digest).success) throw precondition('回调恢复不能使用其他原进程或输入身份');
        const existing = (await tx.execute<{ body: Record<string, unknown> }>(sql`SELECT to_jsonb(callback) AS body FROM release.deletion_callbacks AS callback WHERE id=${exit.id} FOR UPDATE`))[0];
        if (!existing) throw precondition('原回调记录已丢失，不能补造退出');
        const current = releaseCallbackContent(existing.body);
        if (!current || current.projectId !== context.target.id || releaseCallbackIdentity(current) !== releaseCallbackIdentity(birth)) throw precondition('原回调行的进程或所属关系已变化');
        if (current.exited) continue;
        const recovery = jsonHash({ proof: proof.digest, scope: proof.scopeDigest, exit: exit.digest });
        await tx.execute(sql`UPDATE release.deletion_callbacks SET exited_at=now(),recovery_digest=${recovery},exit_digest=${releaseCallbackIdentity(birth, recovery)} WHERE id=${exit.id}`);
      }
    }),
    advance: (context, evidence) => admitted(context, async (tx, row) => {
      if (context.phase === 'metadata') throw precondition('元数据回执必须与实际清理同事务');
      if (context.phase === 'verify') {
        const current = await releaseContentOver(tx, input, context.target);
        if (!current.inventory.complete || current.rows.length) throw precondition('发布内容仍有残留或来源不完整');
      }
      await record(tx, row, context, evidence);
    }),
    purgeMetadata: (context) => admitted(context, async (tx, row) => {
      if (context.phase !== 'metadata') throw precondition('发布内容只能在 metadata 清理');
      if (row.receipts.metadata) return row.receipts.metadata;
      predecessor(row, context); const current = await releaseContentOver(tx, input, context.target); sameContent(row.original.content, current);
      const count = await purgeRows(tx, row.original), evidence: ProjectDeletionEvidence = { kind: 'metadata', count, digest: jsonHash({ operationId: context.operationId, revision: context.confirmed.revision, metadataPurged: true, count }), description: '本项目发布内容清理，平台目录和其他项目的内容保留' };
      const after = await releaseContentOver(tx, input, context.target);
      if (!after.inventory.complete || after.rows.length) throw precondition('发布内容未清空或来源不完整，清理回滚');
      await record(tx, row, context, evidence); return evidence;
    }),
  };
}
