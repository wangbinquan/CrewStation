import { AsyncLocalStorage } from 'node:async_hooks';
import { randomBytes } from 'node:crypto';
import { ProjectDeletionContextSchema, ProjectIdSchema, ResourceIdSchema } from '@crewstation/contracts';
import type { ProjectDeletionContext, ProjectId } from '@crewstation/contracts';
import { jsonHash, newResourceId, precondition } from '@crewstation/kernel';
import { assertSharedDatabaseAdmissionActive, withExclusiveDatabaseAdmission, withSharedDatabaseAdmissions } from '@crewstation/persistence';
import type { Database, Executor } from '@crewstation/persistence';
import { sql } from 'drizzle-orm';
import { ProvisioningCallbackProcessSchema, ProvisioningCallbackSchema, ProvisioningContainerProcessSchema, ProvisioningPodProcessSchema, provisioningCallbackIdentity, provisioningContainer } from '../../domain/projectWork';
import type { ProvisioningCallback, ProvisioningWorkKind } from '../../domain/projectWork';
import type { ProvisioningCallbackProcesses, ProvisioningProjectWork } from '../../ports/projectWork';

interface Input { db: Database; processes: ProvisioningCallbackProcesses; sharedAdmissionKeys?: (id: ProjectId) => readonly string[]; assertAvailable(id: ProjectId): Promise<void>; assertGrant(context: ProjectDeletionContext): Promise<void> }
interface Scope { db: Database; projectId: ProjectId; serviceId: string; active: boolean; ping(): Promise<void> }
const scopes = new AsyncLocalStorage<Scope>();
const key = (id: string) => 'provisioning.project-admission:' + ProjectIdSchema.parse(id);
async function history(db: Executor, projectId: ProjectId): Promise<ProvisioningCallback[]> {
  const rows = await db.execute<{ id: string; project_id: string; service_id: string; kind: string; consumer_id: string; backend_pid: number;
    original_process: unknown; input_digest: string; exit_key_hash: string; exited_at: unknown; exit_digest: string | null; recovery_digest: string | null }>(sql`
    SELECT * FROM provisioning.original_callbacks WHERE project_id=${projectId} ORDER BY id`);
  return rows.map((row) => ProvisioningCallbackSchema.parse({ id: row.id, projectId: row.project_id, serviceId: row.service_id, kind: row.kind,
    consumerId: row.consumer_id, backendPid: row.backend_pid, process: row.original_process, inputDigest: row.input_digest, exitKeyDigest: row.exit_key_hash,
    exited: row.exited_at !== null, exitDigest: row.exit_digest, recoveryDigest: row.recovery_digest }));
}
async function close(input: Input, raw: ProjectDeletionContext) {
  const context = ProjectDeletionContextSchema.parse(raw);
  if (context.phase !== 'seal' || context.confirmed.participant !== 'provisioning' || !context.confirmed.complete || context.confirmed.blockers.length || context.confirmed.references.length)
    throw precondition('开通封写缺少原完整删除许可');
  await input.assertGrant(context);
  return withExclusiveDatabaseAdmission(input.db, key(context.target.id), async (tx) => {
    await input.assertGrant(context);
    await tx.execute(sql`SELECT set_config('crewstation.provisioning_deletion_owner',${context.operationId + ':' + context.generation + ':seal'},true)`);
    await tx.execute(sql`INSERT INTO provisioning.project_admissions(project_id,operation_id,generation,revision)
      VALUES(${context.target.id},${context.operationId},${context.generation},${context.confirmed.revision}) ON CONFLICT DO NOTHING`);
    const row = (await tx.execute<{ operation_id: string; generation: number; revision: string }>(sql`SELECT operation_id,generation,revision
      FROM provisioning.project_admissions WHERE project_id=${context.target.id} FOR UPDATE`))[0];
    if (!row || row.operation_id !== context.operationId || row.generation > context.generation || row.generation === context.generation && row.revision !== context.confirmed.revision)
      throw precondition('开通原删除操作、世代或确认修订不符');
    if (row.generation < context.generation) await tx.execute(sql`UPDATE provisioning.project_admissions SET generation=${context.generation},revision=${context.confirmed.revision} WHERE project_id=${context.target.id}`);
    await input.assertGrant(context);
    const pending = await tx.execute<{ id: string }>(sql`SELECT id FROM provisioning.original_callbacks WHERE project_id=${context.target.id} AND exited_at IS NULL ORDER BY id`);
    return { pending: pending.map((row) => row.id) };
  });
}
async function observe(input: Input) {
  await input.processes.sweep({ stopped: async (raw, digest) => {
    const process = ProvisioningContainerProcessSchema.parse(raw);
    if (!/^[a-f0-9]{64}$/.test(digest)) throw precondition('开通原容器停止摘要不完整');
    await input.db.transaction(async (tx) => {
      await tx.execute(sql`SELECT set_config('crewstation.provisioning_callback_stop',${jsonHash({ process, digest })},true)`);
      await tx.execute(sql`INSERT INTO provisioning.callback_stops(identity,original_process,digest) VALUES(${jsonHash(process)},${JSON.stringify(process)}::jsonb,${digest}) ON CONFLICT DO NOTHING`);
      const stop = (await tx.execute<{ digest: string }>(sql`SELECT digest FROM provisioning.callback_stops WHERE identity=${jsonHash(process)}`))[0];
      if (!stop) throw precondition('开通原容器停止事实没有保存');
      const rows = await tx.execute<{ project_id: ProjectId }>(sql`SELECT DISTINCT project_id FROM provisioning.original_callbacks
        WHERE original_process->>'podUid'=${process.podUid} AND original_process->>'containerId'=${process.containerId}
          AND original_process->>'nodeUid'=${process.nodeUid} AND original_process->>'nodeName'=${process.nodeName} AND exited_at IS NULL`);
      for (const row of rows) for (const callback of await history(input.db, row.project_id)) {
        if (callback.exited || jsonHash(provisioningContainer(callback.process)) !== jsonHash(process)) continue;
        await tx.execute(sql`SELECT set_config('crewstation.provisioning_callback_recovery',${jsonHash(process)},true)`);
        await tx.execute(sql`UPDATE provisioning.original_callbacks SET exited_at=clock_timestamp(),recovery_digest=${stop.digest},
          exit_digest=${provisioningCallbackIdentity(callback, stop.digest)} WHERE id=${callback.id} AND exited_at IS NULL`);
      }
    });
  }, podStopped: async (raw, digest) => {
    const process = ProvisioningPodProcessSchema.parse(raw);
    if (!/^[a-f0-9]{64}$/.test(digest)) throw precondition('开通原 Pod 整体停止摘要不完整');
    await input.db.transaction(async (tx) => {
      await tx.execute(sql`SELECT set_config('crewstation.provisioning_callback_pod_stop',${jsonHash({ process, digest })},true)`);
      await tx.execute(sql`INSERT INTO provisioning.pod_stops(identity,original_process,digest) VALUES(${jsonHash(process)},${JSON.stringify(process)}::jsonb,${digest}) ON CONFLICT DO NOTHING`);
      const stop = (await tx.execute<{ digest: string }>(sql`SELECT digest FROM provisioning.pod_stops WHERE identity=${jsonHash(process)}`))[0];
      if (!stop) throw precondition('开通原 Pod 整体停止事实没有保存');
      const projects = await tx.execute<{ project_id: ProjectId }>(sql`SELECT DISTINCT project_id FROM provisioning.original_callbacks
        WHERE original_process->>'podUid'=${process.podUid} AND original_process->>'nodeUid'=${process.nodeUid}
          AND original_process->>'nodeName'=${process.nodeName} AND exited_at IS NULL`);
      for (const row of projects) for (const callback of await history(tx, row.project_id)) {
        if (callback.exited || callback.process.podUid !== process.podUid || callback.process.nodeUid !== process.nodeUid || callback.process.nodeName !== process.nodeName) continue;
        await tx.execute(sql`SELECT set_config('crewstation.provisioning_callback_pod_recovery',${jsonHash(process)},true)`);
        await tx.execute(sql`UPDATE provisioning.original_callbacks SET exited_at=clock_timestamp(),recovery_digest=${stop.digest},
          exit_digest=${provisioningCallbackIdentity(callback,stop.digest)} WHERE id=${callback.id} AND exited_at IS NULL`);
      }
    });
  }, releasable: async (podUid) => (await input.db.execute<{ pending: boolean }>(sql`SELECT EXISTS(SELECT 1 FROM provisioning.original_callbacks
    WHERE original_process->>'podUid'=${podUid} AND exited_at IS NULL) AS pending`))[0]?.pending === false });
}

export function provisioningProjectWork(input: Input): ProvisioningProjectWork {
  const current = (id: ProjectId) => {
    const scope = scopes.getStore();
    if (!scope?.active || scope.db !== input.db || scope.projectId !== id) throw precondition('开通原回调已经退出或不属于本项目');
    assertSharedDatabaseAdmissionActive(input.db, key(id)); return scope;
  };
  const checkCurrent = async (id: ProjectId) => { const scope = current(id); await input.assertAvailable(id); current(id); await scope.ping(); current(id); };
  return { checkCurrent, history: (id) => history(input.db, ProjectIdSchema.parse(id)), close: (context) => close(input, context), observe: () => observe(input),
    run: async <T>(rawProject: ProjectId, rawService: string, kind: ProvisioningWorkKind, inputDigest: string, work: () => Promise<T>): Promise<T> => {
      const projectId = ProjectIdSchema.parse(rawProject), serviceId = ResourceIdSchema.parse(rawService);
      if (!/^[a-f0-9]{64}$/.test(inputDigest)) throw precondition('开通原输入摘要不完整');
      const prior = scopes.getStore();
      if (prior) {
        if (prior.db !== input.db || prior.serviceId !== serviceId) throw precondition('不能扩展开通原回调的项目或服务范围');
        await checkCurrent(projectId); return work();
      }
      // Complete the admitted call graph before IO; nested owners only reuse subsets of these actual locks.
      const keys = [key(projectId), ...(kind === 'provision' ? input.sharedAdmissionKeys?.(projectId) ?? [] : [])];
      return withSharedDatabaseAdmissions(input.db, keys, async (protectedTx) => {
        await input.assertAvailable(projectId);
        if ((await input.db.execute(sql`SELECT project_id FROM provisioning.project_admissions WHERE project_id=${projectId}`)).length) throw precondition('项目开通准入已永久封闭');
        const processIdentity = ProvisioningCallbackProcessSchema.parse(await input.processes.protectCurrent());
        if (processIdentity.pid !== process.pid) throw precondition('开通原 PID 与当前进程不符');
        await input.assertAvailable(projectId); assertSharedDatabaseAdmissionActive(input.db, key(projectId));
        const backendPid = Number((await protectedTx.execute<{ pid: number }>(sql`SELECT pg_backend_pid() AS pid`))[0]!.pid), exitKey = randomBytes(32).toString('hex');
        const birth = ProvisioningCallbackSchema.parse({ id: newResourceId(), projectId, serviceId, kind, consumerId: newResourceId(), backendPid,
          process: processIdentity, inputDigest, exitKeyDigest: jsonHash(exitKey), exited: false, exitDigest: null, recoveryDigest: null });
        await input.db.transaction(async (tx) => { await tx.execute(sql`INSERT INTO provisioning.original_callbacks(id,project_id,service_id,kind,consumer_id,backend_pid,original_process,input_digest,exit_key_hash)
          VALUES(${birth.id},${projectId},${serviceId},${kind},${birth.consumerId},${backendPid},${JSON.stringify(processIdentity)}::jsonb,${inputDigest},${birth.exitKeyDigest})`); });
        const scope: Scope = { db: input.db, projectId, serviceId, active: true, ping: async () => { await protectedTx.execute(sql`SELECT 1`); } };
        return scopes.run(scope, async () => {
          try { await checkCurrent(projectId); return await work(); }
          finally {
            scope.active = false;
            await input.db.transaction(async (tx) => {
              await tx.execute(sql`SELECT set_config('crewstation.provisioning_callback_exit',${exitKey},true)`);
              const changed = await tx.execute(sql`UPDATE provisioning.original_callbacks SET exited_at=clock_timestamp(),exit_digest=${provisioningCallbackIdentity(birth)} WHERE id=${birth.id} AND exited_at IS NULL RETURNING id`);
              if (changed.length !== 1) throw precondition('开通原回调退出事实已经变化');
            });
          }
        });
      });
    } };
}
