import { AsyncLocalStorage } from 'node:async_hooks';
import { randomBytes } from 'node:crypto';
import { ProjectDeletionContextSchema, ProjectIdSchema, ResourceIdSchema } from '@crewstation/contracts';
import type { ProjectDeletionContext, ProjectId } from '@crewstation/contracts';
import { jsonHash, newResourceId, precondition } from '@crewstation/kernel';
import { assertSharedDatabaseAdmissionActive, withSharedDatabaseAdmission } from '@crewstation/persistence';
import type { Database, Transaction } from '@crewstation/persistence';
import { sql } from 'drizzle-orm';
import { RuntimeWorkCallbackSchema, RuntimeWorkGrantSchema, RuntimeWorkProcessSchema, runtimeWorkIdentity } from '../../../domain/deletion/work';
import type { RuntimeWorkCallback, RuntimeWorkInput } from '../../../domain/deletion/work';
import type { RuntimeProjectWork, RuntimeWorkSources } from '../../../ports/deletion/work';
import { registerRuntimeWorkOrigin, runtimeWorkOrigin } from './workOrigin';
import { runtimeWorkHistory } from './workHistory';
import { observeRuntimeWork } from './workRecovery';

interface Scope { readonly input: RuntimeWorkInput; readonly context: ProjectDeletionContext | undefined; readonly id: string; readonly revision: string;
  readonly retained: Set<Promise<unknown>>; active: boolean; ping(): Promise<void> }
interface Lifetime { readonly scopes: AsyncLocalStorage<Scope>; readonly pending: Set<Promise<unknown>>; check(): Promise<void> }
export const runtimeProjectAdmissionKey = (id: ProjectId) => 'task-runtime.project-admission:' + id;
async function originalExit(db: Database, nonce: string, birth: RuntimeWorkCallback) {
  await db.transaction(async (tx) => {
    await tx.execute(sql`SELECT set_config('crewstation.task_runtime_callback_exit',${nonce},true)`);
    const changed = await tx.execute(sql`UPDATE task_runtime.original_callbacks SET exited_at=clock_timestamp(),exit_digest=${runtimeWorkIdentity(birth)} WHERE id=${birth.id} AND exited_at IS NULL RETURNING id`);
    if (changed.length !== 1) throw precondition('运行原回调退出事实已经变化');
  });
}
async function available(db: Database, sources: RuntimeWorkSources, input: RuntimeWorkInput, context?: ProjectDeletionContext) {
  const origin = await runtimeWorkOrigin(db, sources, input.originKind, input.originKey);
  if (origin.scope !== 'project' || origin.projectIds[0] !== input.projectId) throw precondition('运行原回调与项目归属不符');
  const [seal] = await db.execute<{ operation_id: string; generation: number }>(sql`SELECT operation_id,generation FROM task_runtime.project_admissions WHERE project_id=${input.projectId}`);
  if (context) {
    const grant = grantFor(context)!;
    if (context.target.id !== input.projectId || !seal || seal.operation_id !== grant.operationId || seal.generation !== grant.generation)
      throw precondition('运行删除许可与原封写项目或世代不符');
    await sources.assertGrant(context);
  } else {
    if (seal) throw precondition('运行项目准入已永久封闭', { code: 'runtime_project_admission_closed' });
    await sources.assertAvailable(input.projectId);
  }
  return origin;
}
const grantFor = (context?: ProjectDeletionContext) => context ? RuntimeWorkGrantSchema.parse({ operationId: context.operationId, generation: context.generation, phase: context.phase }) : null;
async function birth(db: Database, sources: RuntimeWorkSources, protectedTx: Transaction, input: RuntimeWorkInput, context?: ProjectDeletionContext) {
  const origin = await available(db, sources, input, context), processIdentity = RuntimeWorkProcessSchema.parse(await sources.processes.protectCurrent());
  if (processIdentity.pid !== process.pid) throw precondition('运行原回调 PID 与当前进程不符');
  const backendPid = (await protectedTx.execute<{ pid: number }>(sql`SELECT pg_backend_pid() AS pid`))[0]!.pid, nonce = randomBytes(32).toString('hex');
  const value = RuntimeWorkCallbackSchema.parse({ ...input, originId: origin.id, id: newResourceId(), consumerId: newResourceId(), grant: grantFor(context),
    originRevision: origin.revision, backendPid, process: processIdentity, exitKeyDigest: jsonHash(nonce), exited: false, exitDigest: null, recoveryDigest: null });
  await db.transaction(async (tx) => {
    if (value.grant) await tx.execute(sql`SELECT set_config('crewstation.task_runtime_work_grant',${jsonHash(value.grant)},true)`);
    await registerRuntimeWorkOrigin(tx, input, origin);
    await tx.execute(sql`INSERT INTO task_runtime.original_callbacks(id,project_id,origin_kind,origin_key,origin_id,kind,reference,consumer_id,input_digest,origin_revision,backend_pid,original_process,exit_key_hash,deletion_grant)
      VALUES(${value.id},${value.projectId},${value.originKind},${value.originKey},${value.originId},${value.kind},${value.reference},${value.consumerId},${value.inputDigest},${value.originRevision},${backendPid},${JSON.stringify(processIdentity)}::jsonb,${value.exitKeyDigest},${value.grant ? JSON.stringify(value.grant) : null}::jsonb)`);
  });
  return { value, nonce };
}
async function admitted<T>(db: Database, sources: RuntimeWorkSources, life: Lifetime, protectedTx: Transaction, input: RuntimeWorkInput, context: ProjectDeletionContext | undefined, callback: () => Promise<T>) {
  const original = await birth(db, sources, protectedTx, input, context), privateLifetime = Promise.withResolvers<void>();
  life.pending.add(privateLifetime.promise);
  const scope: Scope = { input, context, id: original.value.id, revision: original.value.originRevision, retained: new Set(), active: true,
    ping: async () => { await protectedTx.execute(sql`SELECT 1`); } };
  return life.scopes.run(scope, async () => {
    try { await life.check(); return await callback(); }
    finally {
      scope.active = false;
      while (scope.retained.size) await Promise.allSettled([...scope.retained]);
      try { await originalExit(db, original.nonce, original.value); }
      finally { privateLifetime.resolve(); life.pending.delete(privateLifetime.promise); }
    }
  });
}

export function runtimeProjectWork(db: Database, sources: RuntimeWorkSources, lifetimeError: (error: unknown) => void = () => undefined): RuntimeProjectWork {
  const scopes = new AsyncLocalStorage<Scope>(), pending = new Set<Promise<unknown>>();
  const retain = <T>(promise: Promise<T>) => { pending.add(promise); const remove = () => { pending.delete(promise); }; promise.then(remove, remove); return promise; };
  const current = () => {
    const scope = scopes.getStore(); if (!scope?.active) throw precondition('运行原回调已退出，不能再发起副作用');
    assertSharedDatabaseAdmissionActive(db, runtimeProjectAdmissionKey(scope.input.projectId)); return scope;
  };
  const check = async () => {
    const scope = current(), origin = await available(db, sources, scope.input, scope.context); current();
    if (origin.revision !== scope.revision) throw precondition('运行原回调来源发生替换'); await scope.ping(); current();
  };
  const life: Lifetime = { scopes, pending, check };
  const run = async <T>(raw: RuntimeWorkInput, callback: () => Promise<T>, context?: ProjectDeletionContext) => {
    const input = { ...raw, projectId: ProjectIdSchema.parse(raw.projectId), reference: ResourceIdSchema.parse(raw.reference) }, parent = scopes.getStore();
    if (parent) {
      await check(); if (parent.input.projectId !== input.projectId) throw precondition('运行原回调不能扩展到另一项目');
      if (jsonHash(grantFor(parent.context)) !== jsonHash(grantFor(context))) throw precondition('运行原回调不能改变删除许可');
    }
    const promise = withSharedDatabaseAdmission(db, runtimeProjectAdmissionKey(input.projectId), (tx) => admitted(db, sources, life, tx, input, context, callback));
    parent?.retained.add(promise); promise.then(() => { parent?.retained.delete(promise); }, () => { parent?.retained.delete(promise); }); return retain(promise);
  };
  const runOrigin = <T>(input: Omit<RuntimeWorkInput, 'projectId'>, callback: () => Promise<T>, response = false) => retain((async () => {
    const origin = await runtimeWorkOrigin(db, sources, input.originKind, input.originKey);
    // A real platform profile-test scope has no project to delete; it cannot supply a project grant.
    if (origin.scope === 'platform') {
      if (scopes.getStore()) throw precondition('项目运行回调不能借用平台测试范围');
      return callback();
    }
    return response ? api.runResponse({ ...input, projectId: origin.projectIds[0]! }, callback) : run({ ...input, projectId: origin.projectIds[0]! }, callback);
  })());
  const api: RuntimeProjectWork = {
    run: (input, callback) => run(input, callback), runOrigin: (input, callback) => runOrigin(input, callback), runOriginResponse: (input, callback) => runOrigin(input, callback, true),
    runGranted: async (context, input, callback) => {
      const original = ProjectDeletionContextSchema.parse(structuredClone(context));
      if (original.confirmed.participant !== 'task-runtime') throw precondition('运行清理许可不属于 task-runtime');
      return run({ ...input, projectId: original.target.id, kind: 'deletion' }, callback, original);
    },
    history: (project) => runtimeWorkHistory(db, ProjectIdSchema.parse(project)), observe: () => observeRuntimeWork(db, sources.processes),
    drain: async () => { while (pending.size) await Promise.allSettled([...pending]); },
    runResponse: (input, callback) => {
      const response = Promise.withResolvers<Awaited<ReturnType<typeof callback>>>();
      void run(input, async () => { const value = await callback(); response.resolve(value); return value; })
        .catch((error: unknown) => { response.reject(error); lifetimeError(error); }); return response.promise;
    },
    effect: async (inputDigest, callback) => {
      const parent = current(); await check();
      return run({ ...parent.input, kind: 'effect', reference: parent.id, inputDigest }, async () => { const value = await callback(); await check(); return value; }, parent.context);
    },
    whenActive: (inputDigest, callback) => scopes.getStore() ? api.effect(inputDigest, callback) : callback(),
  };
  return api;
}
