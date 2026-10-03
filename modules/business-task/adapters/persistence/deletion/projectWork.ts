import { AsyncLocalStorage } from 'node:async_hooks';
import { randomBytes } from 'node:crypto';
import { ProjectDeletionContextSchema, ProjectIdSchema, ResourceIdSchema } from '@crewstation/contracts';
import type { ProjectDeletionContext, ProjectId } from '@crewstation/contracts';
import { jsonHash, newResourceId, precondition } from '@crewstation/kernel';
import { assertSharedDatabaseAdmissionActive, withExclusiveDatabaseAdmission, withSharedDatabaseAdmission } from '@crewstation/persistence';
import type { Database } from '@crewstation/persistence';
import { sql } from 'drizzle-orm';
import { BusinessWorkCallbackSchema, BusinessWorkOriginSchema, BusinessWorkProcessSchema, businessWorkIdentity } from '../../../domain/deletion/work';
import type { BusinessProjectWork, BusinessWorkSources } from '../../../ports/deletion/work';
import { businessWorkHistory } from './workHistory';
import { observeBusinessWork } from './workRecovery';
import { registerBusinessOrigin } from './origins';

interface Scope { id: string; projectId: ProjectId; serviceId: string; kind: string; reference: string; inputDigest: string; originRevision: string; active: boolean; retained: Set<Promise<unknown>>; ping(): Promise<void> }
const key = (id: ProjectId) => 'business-task.project-admission:' + id;
async function seal(db: Database, sources: BusinessWorkSources, raw: ProjectDeletionContext) {
  const context = ProjectDeletionContextSchema.parse(raw);
  if (context.phase !== 'seal' || context.confirmed.participant !== 'business-task' || !context.confirmed.complete
    || context.confirmed.blockers.length || context.confirmed.references.length) throw precondition('业务封写缺少原完整删除许可');
  await sources.assertGrant(context);
  return withExclusiveDatabaseAdmission(db, key(context.target.id), async (tx) => {
    await sources.assertGrant(context);
    await tx.execute(sql`SELECT set_config('crewstation.business_task_deletion_owner',${context.operationId + ':' + context.generation + ':seal'},true)`);
    await tx.execute(sql`INSERT INTO business_task.project_admissions(project_id,operation_id,generation,revision)
      VALUES(${context.target.id},${context.operationId},${context.generation},${context.confirmed.revision}) ON CONFLICT DO NOTHING`);
    const row = (await tx.execute<{ operation_id: string; generation: number; revision: string }>(sql`SELECT operation_id,generation,revision
      FROM business_task.project_admissions WHERE project_id=${context.target.id} FOR UPDATE`))[0];
    if (!row || row.operation_id !== context.operationId || row.generation > context.generation || row.generation === context.generation && row.revision !== context.confirmed.revision)
      throw precondition('业务原删除操作、世代或确认修订不符');
    if (row.generation < context.generation) await tx.execute(sql`UPDATE business_task.project_admissions SET generation=${context.generation},revision=${context.confirmed.revision} WHERE project_id=${context.target.id}`);
    await sources.assertGrant(context);
    return { pending: (await tx.execute<{ id: string }>(sql`SELECT id FROM business_task.original_callbacks WHERE project_id=${context.target.id} AND exited_at IS NULL ORDER BY id`)).map((item) => item.id) };
  });
}
export function businessProjectWork(db: Database, sources: BusinessWorkSources): BusinessProjectWork {
  const scopes = new AsyncLocalStorage<Scope>();
  const available = async (projectId: ProjectId, serviceId: string) => {
    const origin = BusinessWorkOriginSchema.parse(await sources.resolve('service', serviceId, 'current'));
    if (origin.id !== serviceId || origin.projectIds[0] !== projectId) throw precondition('业务原回调服务与项目归属不符');
    await sources.assertAvailable(projectId);
    if ((await db.execute(sql`SELECT project_id FROM business_task.project_admissions WHERE project_id=${projectId}`)).length) throw precondition('业务项目准入已永久封闭');
    return origin;
  };
  const current = (projectId: ProjectId, serviceId: string) => {
    const scope = scopes.getStore();
    if (!scope?.active || scope.projectId !== projectId || scope.serviceId !== serviceId) throw precondition('业务原回调已退出或不能扩展项目／服务范围');
    assertSharedDatabaseAdmissionActive(db, key(projectId)); return scope;
  };
  const checkCurrent = async (projectId: ProjectId, serviceId: string) => {
    const scope = current(projectId, serviceId), origin = await available(projectId, serviceId); current(projectId, serviceId);
    if (origin.revision !== scope.originRevision) throw precondition('业务原回调来源发生替换');
    await scope.ping(); current(projectId, serviceId);
  };
  const effect = async <T>(callback: () => Promise<T>): Promise<T> => {
    const scope = scopes.getStore(); if (!scope) throw precondition('业务副作用缺少原受理回调');
    await checkCurrent(scope.projectId, scope.serviceId); const result = await callback();
    await checkCurrent(scope.projectId, scope.serviceId); return result;
  };
  const api: BusinessProjectWork = { checkCurrent, history: (id) => businessWorkHistory(db, ProjectIdSchema.parse(id)), seal: (context) => seal(db, sources, context),
    callbackId: () => { const scope = scopes.getStore(); if (!scope?.active) throw precondition('业务票据缺少原受理回调'); current(scope.projectId, scope.serviceId); return scope.id; },
    retain: (pending) => { const scope = scopes.getStore(); if (!scope) throw precondition('业务后台任务缺少原受理回调'); current(scope.projectId, scope.serviceId); scope.retained.add(pending); return pending; },
    effect, whenActive: (callback) => scopes.getStore() ? effect(callback) : callback(),
    runService: (raw, callback) => {
      const pending = (async () => {
        const serviceId = ResourceIdSchema.parse(raw.serviceId), origin = BusinessWorkOriginSchema.parse(await sources.resolve('service', serviceId, 'current'));
        return api.run({ ...raw, serviceId, projectId: origin.projectIds[0]! }, callback);
      })();
      scopes.getStore()?.retained.add(pending); return pending;
    },
    observe: () => observeBusinessWork(db, sources.processes),
    run: async (raw, callback) => {
      const projectId = ProjectIdSchema.parse(raw.projectId), serviceId = ResourceIdSchema.parse(raw.serviceId);
      const prior = scopes.getStore();
      if (prior) {
        await checkCurrent(projectId, serviceId);
        if (prior.reference === raw.reference && prior.inputDigest === raw.inputDigest && prior.kind === raw.kind) return callback();
        if (!['service-api', 'legacy-api', 'contract'].includes(prior.kind)) throw precondition('业务原回调不能扩展到另一任务派发');
      }
      return withSharedDatabaseAdmission(db, key(projectId), async (protectedTx) => {
        const origin = await available(projectId, serviceId), processIdentity = BusinessWorkProcessSchema.parse(await sources.processes.protectCurrent());
        if (processIdentity.pid !== process.pid) throw precondition('业务原回调 PID 与当前进程不符');
        const backendPid = (await protectedTx.execute<{ pid: number }>(sql`SELECT pg_backend_pid() AS pid`))[0]!.pid, exitKey = randomBytes(32).toString('hex');
        const birth = BusinessWorkCallbackSchema.parse({ ...raw, projectId, serviceId, id: newResourceId(), consumerId: newResourceId(),
          originRevision: origin.revision, backendPid, process: processIdentity, exitKeyDigest: jsonHash(exitKey), exited: false, exitDigest: null, recoveryDigest: null });
        await db.transaction(async (tx) => {
          await registerBusinessOrigin(tx, { kind: 'service', key: serviceId, id: serviceId, projectId, identity: jsonHash({ kind: 'service', key: serviceId, id: serviceId, projectId }) });
          await tx.execute(sql`INSERT INTO business_task.original_callbacks(id,project_id,service_id,kind,reference,consumer_id,input_digest,origin_revision,backend_pid,original_process,exit_key_hash)
          VALUES(${birth.id},${projectId},${serviceId},${birth.kind},${birth.reference},${birth.consumerId},${birth.inputDigest},${birth.originRevision},${backendPid},${JSON.stringify(processIdentity)}::jsonb,${birth.exitKeyDigest})`); });
        const scope: Scope = { id: birth.id, projectId, serviceId, kind: birth.kind, reference: birth.reference, inputDigest: birth.inputDigest, originRevision: origin.revision, active: true, retained: new Set(), ping: async () => { await protectedTx.execute(sql`SELECT 1`); } };
        return scopes.run(scope, async () => {
          try { await checkCurrent(projectId, serviceId); return await callback(); }
          finally {
            await Promise.allSettled([...scope.retained]);
            scope.active = false;
            await db.transaction(async (tx) => {
              await tx.execute(sql`SELECT set_config('crewstation.business_task_callback_exit',${exitKey},true)`);
              const changed = await tx.execute(sql`UPDATE business_task.original_callbacks SET exited_at=clock_timestamp(),exit_digest=${businessWorkIdentity(birth)} WHERE id=${birth.id} AND exited_at IS NULL RETURNING id`);
              if (changed.length !== 1) throw precondition('业务原回调退出事实已经变化');
            });
          }
        });
      });
    } };
  return api;
}
