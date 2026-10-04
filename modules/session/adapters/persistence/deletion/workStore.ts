import { randomBytes } from 'node:crypto';
import type { ProjectDeletionContext } from '@crewstation/contracts';
import { jsonHash, newResourceId, precondition } from '@crewstation/kernel';
import type { Database, Executor } from '@crewstation/persistence';
import { withExclusiveDatabaseAdmission } from '@crewstation/persistence';
import { sql } from 'drizzle-orm';
import { SessionWorkBirthSchema, SessionWorkGrantSchema, sessionWorkIdentity } from '../../../domain/deletion/work';
import type { SessionWorkBirth, SessionWorkInput } from '../../../domain/deletion/work';
import { SessionProcessSchema } from '../../../domain/deletion/process';
import type { SessionDeletionSources } from '../../../ports/projectDeletion';
import { readSessionTask, registerSessionTask } from './identity';

export const sessionWorkKey = (projectId: string | null) => projectId === null ? 'session.platform-admission' : 'session.project-admission:' + projectId;
export async function renewSessionStop(db: Database, sources: SessionDeletionSources, context: ProjectDeletionContext) {
  await withExclusiveDatabaseAdmission(db, sessionWorkKey(context.target.id), async (tx) => {
    await sources.assertGrant(context);
    const [scope] = await tx.execute<{ operation_id: string; generation: number; revision: string; verified: boolean; phases: Record<string, unknown> }>(sql`
      SELECT operation_id,generation,revision,verified,phases FROM session.project_deletions WHERE project_id=${context.target.id} FOR UPDATE`);
    if (!scope?.verified || scope.operation_id !== context.operationId || scope.generation > context.generation
      || scope.revision !== context.confirmed.revision || !scope.phases.seal || scope.phases.stop)
      throw precondition('会话清理命令缺少原封写范围或停止阶段已经完成');
    await tx.execute(sql`SELECT set_config('crewstation.session_deletion',${context.operationId + ':' + context.generation + ':stop'},true)`);
    await tx.execute(sql`UPDATE session.project_deletions SET generation=${context.generation} WHERE project_id=${context.target.id}`);
    await sources.assertGrant(context);
  });
}
export async function sessionWorkBirth(db: Database, sources: SessionDeletionSources, admitted: Executor,
  input: SessionWorkInput, context?: ProjectDeletionContext) {
  const origin = await readSessionTask(sources, input.taskKey);
  if (context) {
    if (origin.projectId !== context.target.id) throw precondition('会话清理命令不属于原项目');
    await sources.assertGrant(context);
  } else if (origin.projectId) await sources.assertAvailable(origin.projectId);
  const processIdentity = sources.processes ? SessionProcessSchema.parse(await sources.processes.protectCurrent()) : null;
  if (processIdentity && processIdentity.pid !== process.pid) throw precondition('会话原命令与当前受保护进程 PID 不符');
  if (context && processIdentity === null) throw precondition('会话清理命令缺少原受保护进程');
  const backendPid = (await admitted.execute<{ pid: number }>(sql`SELECT pg_backend_pid() AS pid`))[0]!.pid;
  const nonce = randomBytes(32).toString('hex');
  const grant = context ? SessionWorkGrantSchema.parse({ operationId: context.operationId, generation: context.generation, phase: context.phase, revision: context.confirmed.revision }) : null;
  const birth = SessionWorkBirthSchema.parse({ ...input, id: newResourceId(), projectId: origin.projectId, taskId: origin.id,
    originRevision: origin.identity, backendPid, process: processIdentity, grant, exitKeyDigest: jsonHash(nonce) });
  const identity = sessionWorkIdentity(birth);
  await db.transaction(async (tx) => {
    const registered = await registerSessionTask(tx, sources, input.taskKey);
    if (jsonHash(registered) !== jsonHash(origin)) throw precondition('会话原命令归属已经替换');
    await tx.execute(sql`SELECT set_config('crewstation.session_work_birth',${identity},true),set_config('crewstation.session_work_grant',${grant ? jsonHash(grant) : ''},true)`);
    await tx.execute(sql`INSERT INTO session.original_callbacks(id,project_id,task_key,task_id,origin_revision,kind,reference,input_digest,backend_pid,original_process,deletion_grant,exit_key_hash,identity)
      VALUES(${birth.id},${birth.projectId},${birth.taskKey},${birth.taskId},${birth.originRevision},${birth.kind},${birth.reference},${birth.inputDigest},${birth.backendPid},
      ${processIdentity ? JSON.stringify(processIdentity) : null}::jsonb,${grant ? JSON.stringify(grant) : null}::jsonb,${birth.exitKeyDigest},${identity})`);
  });
  return { birth, nonce };
}
export async function exitSessionWork(db: Database, birth: SessionWorkBirth, nonce: string) {
  await db.transaction(async (tx) => {
    await tx.execute(sql`SELECT set_config('crewstation.session_work_exit',${nonce},true)`);
    const changed = await tx.execute(sql`UPDATE session.original_callbacks SET exited_at=clock_timestamp(),exit_digest=${sessionWorkIdentity(birth)}
      WHERE id=${birth.id} AND identity=${sessionWorkIdentity(birth)} AND exited_at IS NULL RETURNING id`);
    if (changed.length !== 1) throw precondition('会话原命令退出事实已经变化');
  });
}
