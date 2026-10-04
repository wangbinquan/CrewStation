import { AsyncLocalStorage } from 'node:async_hooks';
import { jsonHash, precondition } from '@crewstation/kernel';
import type { Database } from '@crewstation/persistence';
import { assertSharedDatabaseAdmissionActive, withSharedDatabaseAdmission } from '@crewstation/persistence';
import { sql } from 'drizzle-orm';
import type { SessionConnectionHistory, SessionDeletionSources } from '../../../ports/projectDeletion';
import { SessionProcessSchema } from '../../../domain/deletion/process';
import { registerSessionTask } from './identity';

interface Scope { taskId: string; key: string; backendPid: number; active: boolean }
export function sessionConnectionHistory(db: Database, sources: SessionDeletionSources): SessionConnectionHistory {
  const scopes = new AsyncLocalStorage<Scope>();
  const check = async (taskId: string) => {
    const origin = await db.transaction((tx) => registerSessionTask(tx, sources, taskId));
    if (origin.projectId) await sources.assertAvailable(origin.projectId);
    const closed = await db.execute(sql`SELECT d.project_id FROM session.project_deletions d JOIN session.task_origins t ON t.project_id=d.project_id WHERE t.task_key=${taskId}`);
    if (closed.length) throw precondition('会话项目准入已永久封闭');
    return origin;
  };
  return {
    check: async (taskId) => { await check(taskId); },
    open: async (taskId, work) => {
      const origin = await check(taskId), key = origin.projectId ? 'session.project-admission:' + origin.projectId : 'session.platform-admission';
      return withSharedDatabaseAdmission(db, key, async (tx) => {
        await check(taskId);
        const backendPid = (await tx.execute<{ pid: number }>(sql`SELECT pg_backend_pid() AS pid`))[0]!.pid;
        const scope: Scope = { taskId: origin.id, key, backendPid, active: true };
        return scopes.run(scope, async () => { try { return await work(); } finally { scope.active = false; } });
      });
    },
    birth: async (input) => {
      const scope = scopes.getStore();
      if (!scope?.active || scope.taskId !== input.taskId) throw precondition('会话出生缺少原受理 scope');
      assertSharedDatabaseAdmissionActive(db, scope.key); await check(input.taskId); assertSharedDatabaseAdmissionActive(db, scope.key);
      const process = sources.processes ? SessionProcessSchema.parse(await sources.processes.protectCurrent()) : undefined;
      assertSharedDatabaseAdmissionActive(db, scope.key);
      const original = { ...input, ...(process ? { process } : {}) }, identity = jsonHash(original);
      await db.transaction(async (tx) => {
        await tx.execute(sql`INSERT INTO session.connections(task_id,replica,consumer_id,connected_at,last_seen_at) VALUES(${input.taskId},${input.replica},${input.id},${input.at}::timestamptz,${input.at}::timestamptz)
          ON CONFLICT(task_id) DO UPDATE SET replica=excluded.replica,consumer_id=excluded.consumer_id,connected_at=excluded.connected_at,last_seen_at=excluded.last_seen_at`);
        await tx.execute(sql`INSERT INTO session.connection_births(id,task_key,replica,connected_at,exit_key_hash,identity,backend_pid,original_process)
          VALUES(${input.id},${input.taskId},${input.replica},${input.at}::timestamptz,${input.exitKeyHash},${identity},${scope.backendPid},${process ? JSON.stringify(process) : null}::jsonb)`);
      });
      return { ...original, identity };
    },
    exit: (birth, privateKey) => db.transaction(async (tx) => {
      const row = (await tx.execute<{ identity: string; exit_key_hash: string; exited_at: unknown }>(sql`SELECT identity,exit_key_hash,exited_at FROM session.connection_births WHERE id=${birth.id} FOR UPDATE`))[0];
      if (!row || row.identity !== birth.identity || row.exit_key_hash !== jsonHash(privateKey)) throw precondition('会话退出的原出生与私有许可不符');
      if (row.exited_at !== null) return;
      await tx.execute(sql`SELECT set_config('crewstation.session_exit',${privateKey},true)`);
      await tx.execute(sql`UPDATE session.connection_births SET exited_at=clock_timestamp(),exit_digest=identity WHERE id=${birth.id}`);
    }),
  };
}
