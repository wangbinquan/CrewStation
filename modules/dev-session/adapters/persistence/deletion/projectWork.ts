import { AsyncLocalStorage } from 'node:async_hooks';
import { randomBytes } from 'node:crypto';
import { ProjectIdSchema, ResourceIdSchema } from '@crewstation/contracts';
import type { ProjectId } from '@crewstation/contracts';
import { jsonHash, newResourceId, precondition } from '@crewstation/kernel';
import { assertSharedDatabaseAdmissionActive, withSharedDatabaseAdmission } from '@crewstation/persistence';
import type { Database } from '@crewstation/persistence';
import { sql } from 'drizzle-orm';
import { DevelopmentWorkCallbackSchema, DevelopmentWorkProcessSchema, developmentWorkIdentity } from '../../../domain/deletion/work';
import type { DevelopmentWorkCallback, DevelopmentWorkInput } from '../../../domain/deletion/work';
import type { DevelopmentProjectWork, DevelopmentWorkSources } from '../../../ports/deletion/work';
import { registerDevelopmentOrigin } from './origins';
import { developmentWorkOrigin } from './workOrigin';
import { developmentWorkHistory } from './workHistory';
import { observeDevelopmentWork } from './workRecovery';

interface Scope { readonly input: DevelopmentWorkInput; readonly id: string; readonly revision: string; readonly retained: Set<Promise<unknown>>; active: boolean; ping(): Promise<void> }
const key = (id: ProjectId) => 'dev-session.project-admission:' + id;
async function originalExit(db: Database, nonce: string, birth: DevelopmentWorkCallback) {
  await db.transaction(async (tx) => {
    await tx.execute(sql`SELECT set_config('crewstation.dev_session_callback_exit',${nonce},true)`);
    const changed = await tx.execute(sql`UPDATE dev_session.original_callbacks SET exited_at=clock_timestamp(),exit_digest=${developmentWorkIdentity(birth)} WHERE id=${birth.id} AND exited_at IS NULL RETURNING id`);
    if (changed.length !== 1) throw precondition('开发原回调退出事实已经变化');
  });
}
async function originInput(db: Database, sources: DevelopmentWorkSources, input: Omit<DevelopmentWorkInput, 'projectId'>) {
  const original = await developmentWorkOrigin(db, sources, input.originKind, input.originKey);
  return { ...input, projectId: original.projectIds[0]! };
}

export function developmentProjectWork(db: Database, sources: DevelopmentWorkSources, lifetimeError: (error: unknown) => void = () => undefined): DevelopmentProjectWork {
  const scopes = new AsyncLocalStorage<Scope>();
  const lifetimes = new Set<Promise<unknown>>();
  const retained = <T>(pending: Promise<T>) => {
    lifetimes.add(pending); const remove = () => { lifetimes.delete(pending); }; pending.then(remove, remove); return pending;
  };
  const available = async (input: DevelopmentWorkInput) => {
    const origin = await developmentWorkOrigin(db, sources, input.originKind, input.originKey);
    if (origin.projectIds[0] !== input.projectId) throw precondition('开发原回调与项目归属不符');
    await sources.assertAvailable(input.projectId);
    if ((await db.execute(sql`SELECT project_id FROM dev_session.project_admissions WHERE project_id=${input.projectId}`)).length)
      throw precondition('开发项目准入已永久封闭');
    return origin;
  };
  const current = () => {
    const scope = scopes.getStore();
    if (!scope?.active) throw precondition('开发原回调已退出，不能再发起副作用');
    assertSharedDatabaseAdmissionActive(db, key(scope.input.projectId)); return scope;
  };
  const check = async () => {
    const scope = current(), origin = await available(scope.input); current();
    if (origin.revision !== scope.revision) throw precondition('开发原回调来源发生替换');
    await scope.ping(); current();
  };
  const api: DevelopmentProjectWork = {
    history: (project) => developmentWorkHistory(db, ProjectIdSchema.parse(project)), observe: () => observeDevelopmentWork(db, sources.processes),
    drain: async () => { while (lifetimes.size) await Promise.allSettled([...lifetimes]); },
    runResponse: (input, callback) => {
      const response = Promise.withResolvers<Awaited<ReturnType<typeof callback>>>();
      // The guard is awaited by its private original finally, independently of the HTTP deadline.
      void api.run(input, async () => { const value = await callback(); response.resolve(value); return value; })
        .catch((error: unknown) => { response.reject(error); lifetimeError(error); });
      return response.promise;
    },
    runOrigin: (input, callback) => retained(originInput(db, sources, input).then((original) => api.run(original, callback))),
    runOriginResponse: (input, callback) => retained(originInput(db, sources, input).then((original) => api.runResponse(original, callback))),
    effect: async (inputDigest, callback) => {
      const parent = current(); await check();
      return api.run({ ...parent.input, kind: 'effect', reference: parent.id, inputDigest }, async () => {
        const value = await callback(); await check(); return value;
      });
    },
    whenActive: (inputDigest, callback) => scopes.getStore() ? api.effect(inputDigest, callback) : callback(),
    run: async (raw, callback) => {
      const projectId = ProjectIdSchema.parse(raw.projectId), reference = ResourceIdSchema.parse(raw.reference), input = { ...raw, projectId, reference };
      const parent = scopes.getStore();
      if (parent) { await check(); if (parent.input.projectId !== projectId) throw precondition('开发原回调不能扩展到另一项目'); }
      const pending = withSharedDatabaseAdmission(db, key(projectId), async (protectedTx) => {
        const origin = await available(input), processIdentity = DevelopmentWorkProcessSchema.parse(await sources.processes.protectCurrent());
        if (processIdentity.pid !== process.pid) throw precondition('开发原回调 PID 与当前进程不符');
        const backendPid = (await protectedTx.execute<{ pid: number }>(sql`SELECT pg_backend_pid() AS pid`))[0]!.pid, exitKey = randomBytes(32).toString('hex');
        const birth = DevelopmentWorkCallbackSchema.parse({ ...input, originId: origin.id, id: newResourceId(), consumerId: newResourceId(),
          originRevision: origin.revision, backendPid, process: processIdentity, exitKeyDigest: jsonHash(exitKey), exited: false, exitDigest: null, recoveryDigest: null });
        await db.transaction(async (tx) => {
          const original = { kind: input.originKind, key: input.originKey, id: origin.id, projectId };
          await registerDevelopmentOrigin(tx, { ...original, identity: jsonHash(original) });
          await tx.execute(sql`INSERT INTO dev_session.original_callbacks(id,project_id,origin_kind,origin_key,origin_id,kind,reference,consumer_id,input_digest,origin_revision,backend_pid,original_process,exit_key_hash)
            VALUES(${birth.id},${projectId},${birth.originKind},${birth.originKey},${birth.originId},${birth.kind},${birth.reference},${birth.consumerId},${birth.inputDigest},${birth.originRevision},${backendPid},${JSON.stringify(processIdentity)}::jsonb,${birth.exitKeyDigest})`);
        });
        const privateLifetime = Promise.withResolvers<void>(); lifetimes.add(privateLifetime.promise);
        const scope: Scope = { input, id: birth.id, revision: origin.revision, retained: new Set(), active: true, ping: async () => { await protectedTx.execute(sql`SELECT 1`); } };
        return scopes.run(scope, async () => {
          try { await check(); return await callback(); }
          finally {
            scope.active = false;
            // Already-started effects keep the shared backend alive. Later continuations cannot start a fresh effect in this closed scope.
            while (scope.retained.size) await Promise.allSettled([...scope.retained]);
            try {
              await originalExit(db, exitKey, birth);
            } finally { privateLifetime.resolve(); lifetimes.delete(privateLifetime.promise); }
          }
        });
      });
      parent?.retained.add(pending); lifetimes.add(pending);
      const remove = () => { parent?.retained.delete(pending); lifetimes.delete(pending); };
      pending.then(remove, remove); return pending;
    },
  };
  return api;
}
