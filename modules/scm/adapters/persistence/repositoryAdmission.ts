import { AsyncLocalStorage } from 'node:async_hooks';
import type { ProjectDeletionContext, ProjectId, ServiceId } from '@crewstation/contracts';
import { ProjectDeletionContextSchema } from '@crewstation/contracts';
import { jsonHash, newResourceId, precondition } from '@crewstation/kernel';
import type { Database, Executor } from '@crewstation/persistence';
import { assertSharedDatabaseAdmissionActive, withExclusiveDatabaseAdmission, withSharedDatabaseAdmission } from '@crewstation/persistence';
import { sql } from 'drizzle-orm';
import { z } from 'zod';
import type { RepositoryWrites, ScmCallbackProcess, ScmCallbackProcesses, ScmExternalEffect, ScmWriteHistory, ScmWriteKind, ScmWriteRecord } from '../../ports/repositoryWrites';

const key = (id: string) => `scm.project-admission:${id}`;
const scopes = new AsyncLocalStorage<{ database: Database; id: string; projectId: ProjectId; serviceId: ServiceId; backendPid: number; active: boolean }>();
const callbackStartedAt = new Date(Date.now() - process.uptime() * 1000).toISOString();
const writeKindSchema = z.enum(['ensure-repository', 'session-credential', 'build-credential', 'credential-revoke', 'release-tag', 'push-branch', 'repository-url']);
const processSchema = z.object({ podUid: z.uuid(), containerId: z.string().regex(/^[a-z0-9]+:\/\/[a-f0-9]{64}$/), nodeUid: z.uuid(), nodeName: z.string().min(1).max(253) }).strict();
const remoteId = z.string().regex(/^[1-9][0-9]*$/).refine((v) => Number.isSafeInteger(Number(v)));
const effectSchema = z.object({ intentId: z.uuid(), kind: z.enum(['repository', 'credential']), stage: z.enum(['intent', 'returned']),
  remoteProjectId: remoteId.optional(), remoteTokenId: remoteId.optional(), path: z.string().min(1).max(512).regex(/^[^\x00-\x20\x7f]+$/).optional(), credentialId: z.uuid().optional(),
  createdAt: z.iso.datetime({ offset: true }).optional(), userId: remoteId.optional(),
}).strict().refine((e) => e.kind === 'repository' ? Boolean(e.path && (e.stage === 'intent' || e.remoteProjectId)) : Boolean(e.remoteProjectId && e.credentialId && (e.stage === 'intent' || e.remoteTokenId)));
type WorkRow = { id: string; project_id: string; service_id: ServiceId; kind: ScmWriteKind; state: 'running' | 'exited'; remote_project_id: string | null; backend_pid: number; callback_pid: number; callback_started_at: Date | string; process: ScmCallbackProcess | null; result: ScmWriteRecord['result']; exit_digest: string | null; effects: ScmExternalEffect[] };
interface Input { db: Database; processes?: ScmCallbackProcesses; assertAvailable?(id: ProjectId): Promise<void>; assertGrant?(context: ProjectDeletionContext): Promise<void> }
const protectedBackend = (id: string) => sql`EXISTS(SELECT 1 FROM pg_catalog.pg_locks WHERE locktype='advisory' AND granted AND mode='ShareLock' AND pid=w.backend_pid
  AND database=(SELECT oid FROM pg_catalog.pg_database WHERE datname=current_database()) AND objsubid=1
  AND classid::bigint=((hashtextextended(${key(id)},0) >> 32) & 4294967295) AND objid::bigint=(hashtextextended(${key(id)},0) & 4294967295))`;

async function assertOpen(db: Executor, projectId: ProjectId) {
  const [fence] = await db.execute(sql`SELECT project_id FROM scm.deletion_fences WHERE project_id=${projectId} AND operation_id IS NOT NULL`);
  if (fence) throw precondition('项目仓库正在永久清理，不能继续写入', { code: 'scm_project_sealed' });
}
async function begin(input: Input, projectId: ProjectId, serviceId: ServiceId, kind: ScmWriteKind, backendPid: number, original: ScmCallbackProcess | null) {
  writeKindSchema.parse(kind);
  const id = newResourceId();
  await input.db.transaction(async (tx) => {
    await assertOpen(tx, projectId);
    await tx.execute(sql`INSERT INTO scm.deletion_identities VALUES ('service',${serviceId},${serviceId},${projectId}) ON CONFLICT DO NOTHING`);
    const [owner] = await tx.execute<{ project_id: string }>(sql`SELECT project_id FROM scm.deletion_identities WHERE kind='service' AND id=${serviceId}`);
    if (owner?.project_id !== projectId) throw precondition('原仓库服务不属于本项目');
    const [binding] = await tx.execute<{ remote_project_id: string }>(sql`SELECT remote_project_id FROM scm.repository_bindings WHERE service_id=${serviceId} AND project_id=${projectId}`);
    await tx.execute(sql`INSERT INTO scm.deletion_work(id,project_id,service_id,kind,remote_project_id,backend_pid,callback_pid,callback_started_at,process)
      VALUES(${id},${projectId},${serviceId},${kind},${binding?.remote_project_id ?? null},${backendPid},${process.pid},${callbackStartedAt},${original ? JSON.stringify(original) : null}::jsonb)`);
  });
  return id;
}
async function finish(db: Database, id: string, backendPid: number, result: 'succeeded' | 'failed') {
  await db.transaction(async (tx) => {
    const [row] = await tx.execute<WorkRow>(sql`SELECT * FROM scm.deletion_work WHERE id=${id} AND backend_pid=${backendPid} FOR UPDATE`);
    if (!row || row.state !== 'running') throw precondition('原 SCM 回调退出事实已变化');
    const digest = jsonHash({ id, backendPid, callbackPid: row.callback_pid, callbackStartedAt: row.callback_started_at, process: row.process, result, effects: row.effects });
    await tx.execute(sql`SELECT set_config('crewstation.scm_work_exit',${id + ':' + backendPid},true)`);
    await tx.execute(sql`UPDATE scm.deletion_work SET state='exited',result=${result},exit_digest=${digest} WHERE id=${id} AND backend_pid=${backendPid}`);
  });
}
async function record(db: Database, raw: ScmExternalEffect) {
  const scope = scopes.getStore(), effect = effectSchema.parse(raw);
  if (!scope || scope.database !== db || !scope.active) throw precondition('远端副作用缺少原 SCM 回调');
  await db.transaction(async (tx) => {
    const [row] = await tx.execute<WorkRow>(sql`SELECT * FROM scm.deletion_work WHERE id=${scope.id} AND backend_pid=${scope.backendPid} FOR UPDATE`);
    if (!row || row.state !== 'running') throw precondition('原 SCM 副作用记录已经退出');
    const previous = row.effects.filter((e) => e.intentId === effect.intentId);
    if (effect.stage === 'intent' ? previous.length !== 0 : previous.length !== 1 || previous[0]?.stage !== 'intent' || previous[0]?.kind !== effect.kind
      || effect.kind === 'credential' && (previous[0]?.remoteProjectId !== effect.remoteProjectId || previous[0]?.credentialId !== effect.credentialId)) throw precondition('原 SCM 副作用意图与结果不匹配');
    await tx.execute(sql`SELECT set_config('crewstation.scm_work_journal',${scope.id + ':' + scope.backendPid},true)`);
    await tx.execute(sql`UPDATE scm.deletion_work SET effects=effects || ${JSON.stringify([effect])}::jsonb WHERE id=${scope.id} AND backend_pid=${scope.backendPid}`);
    if (effect.kind === 'repository' && effect.stage === 'returned') await tx.execute(sql`INSERT INTO scm.deletion_repository_origins VALUES (${scope.projectId},${scope.serviceId},${effect.remoteProjectId!},${effect.path!},${effect.createdAt ?? null},'callback-result',${scope.id}) ON CONFLICT DO NOTHING`);
  });
}
async function history(db: Database, projectId: ProjectId): Promise<ScmWriteHistory> {
  return db.transaction(async (tx) => {
    const tables = await tx.execute<{ table_name: string }>(sql`SELECT table_name FROM information_schema.tables WHERE table_schema='scm' ORDER BY table_name`);
    if (tables.some((r) => !['repository_bindings', 'session_credentials', 'resource_identity_aliases', 'deletion_fences', 'deletion_identities', 'deletion_work', 'deletion_repository_origins'].includes(r.table_name))) throw precondition('SCM 存在未登记的内容表');
    const bindings = await tx.execute<{ row: Record<string, unknown> }>(sql`SELECT to_jsonb(b) AS row FROM scm.repository_bindings b WHERE project_id=${projectId} ORDER BY service_id`);
    const credentials = await tx.execute<{ row: Record<string, unknown> }>(sql`SELECT to_jsonb(c) AS row FROM scm.session_credentials c WHERE service_id IN (SELECT id FROM scm.deletion_identities WHERE kind='service' AND project_id=${projectId}) ORDER BY id`);
    const records = (await tx.execute<WorkRow>(sql`SELECT * FROM scm.deletion_work WHERE project_id=${projectId} ORDER BY id`)).map((r): ScmWriteRecord => ({ id: r.id, serviceId: r.service_id, kind: writeKindSchema.parse(r.kind), state: r.state, remoteProjectId: r.remote_project_id, backendPid: r.backend_pid,
      callbackPid: r.callback_pid, callbackStartedAt: new Date(r.callback_started_at).toISOString(), process: r.process === null ? null : processSchema.parse(r.process), result: r.result, exitDigest: r.exit_digest, effects: r.effects.map((e) => effectSchema.parse(e)) }));
    const identities = await tx.execute<ScmWriteHistory['identities'][number]>(sql`SELECT kind,id,service_id AS "serviceId" FROM scm.deletion_identities WHERE project_id=${projectId} ORDER BY kind,id`);
    const aliases = await tx.execute(sql`SELECT * FROM scm.resource_identity_aliases WHERE id=${projectId} OR id IN (SELECT id FROM scm.deletion_identities WHERE project_id=${projectId}) ORDER BY kind,key`);
    const origins = await tx.execute<ScmWriteHistory['origins'][number]>(sql`SELECT service_id AS "serviceId",remote_project_id AS "remoteProjectId",path_with_namespace AS "pathWithNamespace",remote_created_at AS "createdAt",source FROM scm.deletion_repository_origins WHERE project_id=${projectId} ORDER BY service_id,remote_project_id`);
    const unowned = await tx.execute<{ id: string }>(sql`SELECT id FROM scm.session_credentials c WHERE NOT EXISTS(SELECT 1 FROM scm.deletion_identities WHERE kind='service' AND id=c.service_id) ORDER BY id`);
    return { revision: jsonHash({ bindings, credentials, records, identities, aliases, origins, unowned }), metadataComplete: unowned.length === 0, origins,
      bindings: bindings.map(({ row: r }) => ({ serviceId: r['service_id'] as ServiceId, remoteProjectId: String(r['remote_project_id']), pathWithNamespace: String(r['path_with_namespace']), bindingCreatedAt: new Date(String(r['created_at'])).toISOString() })),
      credentials: credentials.map(({ row: r }) => ({ id: String(r['id']), serviceId: r['service_id'] as ServiceId, remoteTokenId: String(r['remote_token_id']) })), records, identities,
      unresolvedEffects: records.flatMap((r) => r.effects.filter((e) => e.stage === 'intent' && !r.effects.some((other) => other.stage === 'returned' && other.intentId === e.intentId)).map((e) => ({ workId: r.id, intentId: e.intentId }))), unownedCredentialIds: unowned.map((r) => r.id) };
  }, { isolationLevel: 'repeatable read', accessMode: 'read only' });
}
async function grant(input: Input, raw: ProjectDeletionContext, phase: 'seal' | 'stop') {
  const context = ProjectDeletionContextSchema.parse(raw);
  if (context.confirmed.participant !== 'scm' || context.phase !== phase || !input.assertGrant) throw precondition('缺少原 SCM 清理许可');
  await input.assertGrant(context); return context;
}
async function close(input: Input, raw: ProjectDeletionContext) {
  const context = await grant(input, raw, 'seal');
  await withExclusiveDatabaseAdmission(input.db, key(context.target.id), async (tx) => {
    await input.assertGrant!(context);
    await tx.execute(sql`INSERT INTO scm.deletion_fences(project_id) VALUES(${context.target.id}) ON CONFLICT DO NOTHING`);
    const [row] = await tx.execute<{ operation_id: string | null; generation: number }>(sql`SELECT * FROM scm.deletion_fences WHERE project_id=${context.target.id} FOR UPDATE`);
    if (!row || row.operation_id && row.operation_id !== context.operationId || row.generation > context.generation) throw precondition('原 SCM 清理操作或世代不匹配');
    await tx.execute(sql`UPDATE scm.deletion_fences SET operation_id=${context.operationId},generation=${context.generation} WHERE project_id=${context.target.id}`);
    await input.assertGrant!(context);
  });
}
async function observe(input: Input, context?: ProjectDeletionContext) {
  await input.processes?.sweep({ stopped: async (original, digest) => {
    processSchema.parse(original);
    if (!/^[a-f0-9]{64}$/.test(digest)) throw precondition('原 SCM 容器停止摘要无效');
    await input.db.transaction(async (tx) => {
      if (context) await input.assertGrant!(context);
      const rows = await tx.execute<WorkRow>(sql`SELECT * FROM scm.deletion_work w WHERE state='running' AND process=${JSON.stringify(original)}::jsonb
        ${context ? sql`AND project_id=${context.target.id}` : sql``} FOR UPDATE`);
      for (const row of rows) {
        const [active] = await tx.execute<{ protected: boolean }>(sql`SELECT ${protectedBackend(row.project_id)} AS protected FROM scm.deletion_work w WHERE id=${row.id}`);
        if (active?.protected !== false) continue;
        await tx.execute(sql`SELECT set_config('crewstation.scm_work_exit',${row.id + ':' + row.backend_pid},true)`);
        await tx.execute(sql`UPDATE scm.deletion_work SET state='exited',result='interrupted',recovery_digest=${digest},exit_digest=${jsonHash({ id: row.id, original, digest, effects: row.effects })} WHERE id=${row.id}`);
      }
    });
  }, releasable: async (podUid) => {
    const [row] = await input.db.execute<{ pending: boolean }>(sql`SELECT EXISTS(SELECT 1 FROM scm.deletion_work WHERE state='running' AND process->>'podUid'=${podUid}) AS pending`);
    return row?.pending === false;
  } });
}

export function scmRepositoryWrites(input: Input): RepositoryWrites {
  return { assertOriginalActive: () => {
    const scope = scopes.getStore();
    if (!scope || scope.database !== input.db) return;
    if (!scope.active) throw precondition('原 SCM 回调已退出');
    try { assertSharedDatabaseAdmissionActive(input.db, key(scope.projectId)); }
    catch { throw precondition('原 SCM 数据库准入已退出'); }
  }, withAdmission: async (projectId, serviceId, kind, work) => {
    const current = scopes.getStore();
    if (current?.database === input.db) {
      if (!current.active || current.projectId !== projectId || current.serviceId !== serviceId) throw precondition('不能扩展或恢复原 SCM 回调');
      assertSharedDatabaseAdmissionActive(input.db, key(projectId)); return work();
    }
    return withSharedDatabaseAdmission(input.db, key(projectId), async (tx) => {
      await assertOpen(tx, projectId); await input.assertAvailable?.(projectId);
      const backendPid = Number((await tx.execute<{ pid: number }>(sql`SELECT pg_backend_pid() AS pid`))[0]?.pid);
      const original = input.processes ? processSchema.parse(await input.processes.protectCurrent()) : null;
      const id = await begin(input, projectId, serviceId, kind, backendPid, original);
      const scope = { database: input.db, id, projectId, serviceId, backendPid, active: true };
      return scopes.run(scope, async () => {
        let result: 'succeeded' | 'failed' = 'failed';
        try { const value = await work(); result = 'succeeded'; return value; }
        finally { try { await finish(input.db, id, backendPid, result); } finally { scope.active = false; } }
      });
    });
  }, record: (effect) => record(input.db, effect), history: (id) => history(input.db, id), close: (context) => close(input, context), observe: () => observe(input),
  recover: async (raw) => {
    const context = await grant(input, raw, 'stop');
    const [fence] = await input.db.execute<{ operation_id: string; generation: number }>(sql`SELECT operation_id,generation FROM scm.deletion_fences WHERE project_id=${context.target.id}`);
    if (fence?.operation_id !== context.operationId || fence.generation > context.generation) throw precondition('原 SCM 准入尚未关闭');
    await observe(input, context);
  } };
}
