import { ProjectDeletionEvidenceSchema, PROJECT_DELETION_PHASES } from '@crewstation/contracts';
import type { ProjectDeletionContext, ProjectDeletionEvidence, ProjectDeletionTarget } from '@crewstation/contracts';
import { jsonHash, precondition } from '@crewstation/kernel';
import type { Database, Executor } from '@crewstation/persistence';
import { withExclusiveDatabaseAdmission } from '@crewstation/persistence';
import { sql } from 'drizzle-orm';
import { DATA_CONTENT, DATA_REMOVAL, DataDeletionProofsSchema, DataDeletionScopeSchema } from '../../domain/deletionContents';
import type { DataDeletionScope, DataProjectDeletion } from '../../ports/deletion/projectDeletion';
import { inspectDataContent, registeredDataContent } from './deletionInspection';

async function inspection(db: Executor, deps: DataProjectDeletion, target: ProjectDeletionTarget) {
  const current = await inspectDataContent(db,deps.sources,target);
  const retained = (await db.execute<{ body: unknown }>(sql`SELECT body FROM data.project_deletions WHERE project_id=${target.id}`))[0];
  if (retained) {
    const previous = DataDeletionScopeSchema.parse(retained.body);
    if (previous.nativeHistory) {
      if (previous.nativeHistory.digest !== jsonHash(previous.nativeHistory.body)) throw precondition('data retained native history is corrupt');
      current.scope = { ...current.scope, objectsPresent: true, nativeHistory: previous.nativeHistory };
    }
  }
  let sourceIdentity: string | null = null;
  if (current.scope.objectsPresent) {
    if (!deps.physics) {
      current.inventory.complete = false;
      current.inventory.blockers.push({ participant: 'data', code: 'object-source-unavailable', message: '项目对象与传输的原物理历史、版本和消费者来源尚未装配' });
    } else {
      const source = await deps.physics.inspect(target,current.scope);
      if (!/^[a-f0-9]{64}$/.test(source.identity)) throw precondition('data physical source identity is invalid');
      if (source.nativeHistory) {
        const captured = DataDeletionScopeSchema.parse({ ...current.scope, nativeHistory: source.nativeHistory });
        if (captured.nativeHistory?.identity !== source.identity || captured.nativeHistory.digest !== jsonHash(captured.nativeHistory.body)) throw precondition('data retained native history does not bind the original source');
        current.scope = captured;
      }
      sourceIdentity = source.identity; current.inventory.complete &&= source.complete;
      current.inventory.references.push(...source.references); current.inventory.blockers.push(...source.blockers);
      if (source.count !== undefined && (!Number.isSafeInteger(source.count) || source.count < 0)) throw precondition('data physical source count is invalid');
      current.inventory.resources.push({ kind: 'data-object-source', id: target.id, identity: source.identity, sourceIdentity: source.identity, count: source.count ?? current.scope.locations.length, scope: 'physical' });
      current.inventory.revision = jsonHash({ metadata: current.inventory.revision, sourceIdentity, ...(source.nativeHistory ? { nativeRevision: source.nativeHistory.digest } : {}) });
    }
  }
  return { ...current, sourceIdentity };
}
async function load(db: Executor, context: ProjectDeletionContext) {
  const row = (await db.execute<{ operation_id: string; generation: number; revision: string; body: unknown; phases: unknown; verified: boolean; source_identity: string | null }>(sql`SELECT * FROM data.project_deletions WHERE project_id=${context.target.id} FOR UPDATE`))[0];
  if (!row || row.operation_id !== context.operationId || row.generation > context.generation || row.revision !== context.confirmed.revision || !row.verified) throw precondition('data original deletion grant, generation or scope differs');
  if (row.generation < context.generation) await db.execute(sql`UPDATE data.project_deletions SET generation=${context.generation} WHERE project_id=${context.target.id}`);
  return { scope: DataDeletionScopeSchema.parse(row.body), proofs: DataDeletionProofsSchema.parse(row.phases), sourceIdentity: row.source_identity };
}
async function requestsPending(db: Executor, projectId: string) {
  return (await db.execute<{ pending: boolean }>(sql`SELECT EXISTS(SELECT 1 FROM data.object_work WHERE project_id=${projectId} AND state='running') AS pending`))[0]?.pending !== false;
}
function admissionBusy(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false;
  return ('code' in error && error.code === '55P03') || ('cause' in error && admissionBusy(error.cause));
}
export function dataDeletionRepository(db: Database, deps: DataProjectDeletion) {
  const transact = <T>(context: ProjectDeletionContext, work: (tx: Executor) => Promise<T>) => withExclusiveDatabaseAdmission(db,'data.project-admission:' + context.target.id,async tx => {
    await deps.sources.assertGrant(context); await registeredDataContent(tx);
    await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtextextended('data.object-storage',0)),set_config('crewstation.data_deletion',${context.operationId + ':' + context.generation + ':' + context.phase},true)`);
    const result = await work(tx); await deps.sources.assertGrant(context); return result;
  });
  return {
    inspect: (target: ProjectDeletionTarget) => db.transaction(tx => inspection(tx,deps,target), { isolationLevel: 'repeatable read', accessMode: 'read only' }),
    seal: async (context: ProjectDeletionContext) => {
      if (context.phase !== 'seal') throw precondition('data scope requires the seal phase');
      if (await requestsPending(db,context.target.id)) return 'waiting' as const;
      try { return await transact(context,async tx => {
      if (await requestsPending(tx,context.target.id)) return 'waiting' as const;
      const old = (await tx.execute<{ operation_id: string; generation: number; revision: string; verified: boolean }>(sql`SELECT operation_id,generation,revision,verified FROM data.project_deletions WHERE project_id=${context.target.id} FOR UPDATE`))[0];
      if (old && (old.operation_id !== context.operationId || old.generation > context.generation || old.revision !== context.confirmed.revision && old.generation >= context.generation)) throw precondition('data original deletion cannot be replaced');
      if (old?.verified && old.revision === context.confirmed.revision) return true;
      const current = await inspection(tx,deps,context.target), verified = current.inventory.complete && current.inventory.revision === context.confirmed.revision && !current.inventory.blockers.length && !current.inventory.references.length;
      for (const origin of current.scope.origins) {
        await tx.execute(sql`INSERT INTO data.content_origins(kind,key,id,project_id,identity) VALUES(${origin.kind},${origin.key},${origin.id},${origin.projectId},${jsonHash(origin)}) ON CONFLICT DO NOTHING`);
        const found = (await tx.execute<{ identity: string }>(sql`SELECT identity FROM data.content_origins WHERE kind=${origin.kind} AND key=${origin.key}`))[0];
        if (found?.identity !== jsonHash(origin)) throw precondition('data original identity conflicts with retained history');
      }
      await tx.execute(sql`INSERT INTO data.project_deletions(project_id,operation_id,generation,revision,body,verified,source_identity) VALUES(${context.target.id},${context.operationId},${context.generation},${context.confirmed.revision},${JSON.stringify(current.scope)}::jsonb,${verified},${current.sourceIdentity}) ON CONFLICT(project_id) DO UPDATE SET generation=excluded.generation,revision=excluded.revision,body=excluded.body,verified=excluded.verified,source_identity=excluded.source_identity,phases='{}'::jsonb`);
      return verified;
      }); } catch (error) { if (admissionBusy(error)) return 'waiting' as const; throw error; }
    },
    read: (context: ProjectDeletionContext) => transact(context,async tx => {
      const original = await load(tx,context), at = PROJECT_DELETION_PHASES.indexOf(context.phase);
      if (at > 0 && !original.proofs[PROJECT_DELETION_PHASES[at-1]!]) throw precondition('data preceding phase has no durable proof');
      return original;
    }),
    record: (context: ProjectDeletionContext, evidence: ProjectDeletionEvidence) => transact(context,async tx => {
      const original = await load(tx,context), proof = ProjectDeletionEvidenceSchema.parse(evidence), old = original.proofs[context.phase];
      if (old && jsonHash(old) !== jsonHash(proof)) throw precondition('data original phase evidence cannot be replaced');
      if (context.phase === 'metadata' && !old) await purge(tx,context,original.scope);
      await tx.execute(sql`UPDATE data.project_deletions SET generation=${context.generation},phases=phases||${JSON.stringify({ [context.phase]: proof })}::jsonb WHERE project_id=${context.target.id}`);
    }),
  };
}
async function purge(db: Executor, context: ProjectDeletionContext, scope: DataDeletionScope) {
  for (const table of DATA_REMOVAL) {
    const definition = DATA_CONTENT.find(t => t.table === table)!, selected = scope.contents.filter(c => c.table === table);
    for (let offset = 0; offset < selected.length; offset += 200) {
      const page = selected.slice(offset,offset+200);
      for (const content of page) {
        const keys: unknown = JSON.parse(content.key);
        if (!Array.isArray(keys) || keys.length !== definition.keys.length) throw precondition('data original row key is invalid');
      }
      const key = sql.raw('jsonb_build_array(' + definition.keys.map(column => 'r.' + column).join(',') + ')::text');
      const rows = await db.execute(sql`DELETE FROM data.${sql.identifier(table)} r USING jsonb_to_recordset(${JSON.stringify(page.map(({ key,digest }) => ({ key,digest })))}::jsonb) wanted(key text,digest text)
        WHERE ${key}=wanted.key AND encode(sha256(convert_to(to_jsonb(r)::text,'UTF8')),'hex')=wanted.digest RETURNING ${key} AS key`);
      if (rows.length !== page.length) throw precondition('data confirmed original row changed or disappeared');
    }
  }
  for (const release of scope.backendReleases) {
    const rows = await db.execute(sql`UPDATE data.object_backends SET body=jsonb_set(jsonb_set(body,'{reservedBytes}',to_jsonb((body->>'reservedBytes')::bigint-${release.bytes}::bigint)),'{activeTransfers}',to_jsonb((body->>'activeTransfers')::bigint-${release.transfers}::bigint)) WHERE id=${release.backendId} AND (body->>'reservedBytes')::bigint>=${release.bytes}::bigint AND (body->>'activeTransfers')::bigint>=${release.transfers}::bigint RETURNING id`);
    if (rows.length !== 1) throw precondition('data original backend reservation cannot be settled');
  }
  await db.execute(sql`UPDATE data.project_deletions SET body=body||'{"contents":[],"compacted":true}'::jsonb WHERE project_id=${context.target.id}`);
}
