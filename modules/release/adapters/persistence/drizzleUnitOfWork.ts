import { drizzleHandoffs } from './handoff/repository';
import { drizzleMaintenance } from './drizzleMaintenance';
import { publishDomainEvent } from '@crewstation/eventbus';
import { NATIVE_REGISTRY_ADMISSION, ProjectIdSchema, ResourceIdSchema } from '@crewstation/contracts';
import { jsonHash, newResourceId, precondition } from '@crewstation/kernel';
import type { Database, Executor } from '@crewstation/persistence';
import { assertSharedDatabaseAdmissionActive, withSharedDatabaseAdmissions } from '@crewstation/persistence';
import { AsyncLocalStorage } from 'node:async_hooks';
import { randomBytes } from 'node:crypto';
import { sql } from 'drizzle-orm';
import type { RepositoryScope, UnitOfWork } from '../../ports/unitOfWork';
import type { ReleaseProjectAdmissions } from '../../ports/unitOfWork';
import { ReleaseCallbackProcessSchema, releaseCallbackIdentity } from '../../domain/release';
import type { ReleaseCallbackProcess } from '../../domain/release';
import { drizzleOfflinePolicyRepository, drizzleReleaseRepository, drizzleSlotEventRepository, drizzleSlotRepository, drizzleTrafficSwitchRepository } from './drizzleRepositories';
import type { SlotProjectionDeps } from './ledgerProjection';
import { failJobRecord, findJobRecord, findSlotRecord, ledgerSlotRepository, projectJob, syncSlotLedger } from './ledgerProjection';

/** 可选的资源台账投影（RFC-025 第三期）：给了就在每次槽保存的同一事务里同步台账。 */
export function scopeOver(executor: Executor, lockSlots = false, projection?: SlotProjectionDeps): RepositoryScope {
  const releases = drizzleReleaseRepository(executor), slots = drizzleSlotRepository(executor, lockSlots), offlinePolicy = drizzleOfflinePolicyRepository(executor);
  const sources = { releases, offlinePolicy };
  return {
    handoffs: drizzleHandoffs(executor),
    maintenance: drizzleMaintenance(executor),
    releases,
    slots: projection ? ledgerSlotRepository(slots, (value) => syncSlotLedger(executor, projection, sources, value)) : slots,
    ...(projection ? { ledger: {
      sync: (value: Parameters<typeof syncSlotLedger>[3]) => syncSlotLedger(executor, projection, sources, value),
      slot: (serviceId: Parameters<typeof findSlotRecord>[2], physical: Parameters<typeof findSlotRecord>[3]) => findSlotRecord(executor, projection, serviceId, physical),
      job: (job: Parameters<typeof projectJob>[2]) => projectJob(executor, projection, job),
      jobRecord: (releaseId: string, kind: Parameters<typeof projectJob>[2]['kind']) => findJobRecord(executor, projection, releaseId, kind),
      failJob: (releaseId: string, kind: Parameters<typeof projectJob>[2]['kind'], message: string) => failJobRecord(executor, projection, releaseId, kind, message),
    } } : {}),
    switches: drizzleTrafficSwitchRepository(executor),
    slotEvents: drizzleSlotEventRepository(executor),
    offlinePolicy,
    events: { publish: async (topic, payload) => { await publishDomainEvent(executor, topic, payload); } },
  };
}

export function drizzleUnitOfWork(db: Database, projection?: SlotProjectionDeps): UnitOfWork {
  const run: UnitOfWork['run'] = (fn) => db.transaction((tx) => fn(scopeOver(tx, true, projection))), read = scopeOver(db, false, projection);
  // These historical "read" repositories also expose writes. Route every write through a real UOW so admission identity reaches SQL.
  return { run, read: { ...read,
    releases: { ...read.releases, insert: (r) => run((s) => s.releases.insert(r)), update: (r) => run((s) => s.releases.update(r)), recordConfigVersion: (id, version) => run((s) => s.releases.recordConfigVersion(id, version)) },
    slots: { ...read.slots, initialize: (r) => run((s) => s.slots.initialize(r)), save: (r) => run((s) => s.slots.save(r)) },
    handoffs: { ...read.handoffs, insert: (r) => run((s) => s.handoffs.insert(r)), claim: (id, owner) => run((s) => s.handoffs.claim(id, owner)), settle: (r, update) => run((s) => s.handoffs.settle(r, update)) },
    maintenance: { ...read.maintenance, save: (r) => run((s) => s.maintenance.save(r)), setOverride: (id, physical, replicas) => run((s) => s.maintenance.setOverride(id, physical, replicas)) },
    switches: { ...read.switches, insert: (r) => run((s) => s.switches.insert(r)) }, slotEvents: { ...read.slotEvents, insert: (r) => run((s) => s.slotEvents.insert(r)) },
    offlinePolicy: { ...read.offlinePolicy, save: (r, revision) => run((s) => s.offlinePolicy.save(r, revision)) },
  } };
}

export const releaseAdmissionKey = (id: string) => 'release.project-admission:' + ProjectIdSchema.parse(id);
const callbackScopes = new AsyncLocalStorage<{ db: Database; projectId: string; serviceId: string; active: boolean; ping(): Promise<void> }>();
export function releaseProjectAdmissions(input: { db: Database; protectCurrent(): Promise<ReleaseCallbackProcess>; assertAvailable(projectId: string): Promise<void>; assertNativeRegistryAvailable?: () => Promise<void> }): ReleaseProjectAdmissions {
  const current = () => { const scope = callbackScopes.getStore(); if (!scope?.active || scope.db !== input.db) throw precondition('原发布回调已经退出或不在准入范围'); assertSharedDatabaseAdmissionActive(input.db, releaseAdmissionKey(scope.projectId)); assertSharedDatabaseAdmissionActive(input.db, NATIVE_REGISTRY_ADMISSION); return scope; };
  const checkCurrent = async () => { const scope = current(); await input.assertAvailable(scope.projectId); current(); await scope.ping(); current(); };
  return { checkCurrent, check: async (projectId, serviceId) => { const scope = current(); if (scope.projectId !== projectId || scope.serviceId !== serviceId) throw precondition('不能扩展原发布回调的项目或服务范围'); await checkCurrent(); },
    run: async (rawProject, rawService, callback, work) => {
      const projectId = ProjectIdSchema.parse(rawProject), serviceId = ResourceIdSchema.parse(rawService), consumerId = ResourceIdSchema.parse(callback.consumerId);
      if (!/^[a-f0-9]{64}$/.test(callback.inputDigest)) throw precondition('发布回调缺少原输入摘要');
      const prior = callbackScopes.getStore();
      if (prior?.db === input.db) { if (prior.projectId !== projectId || prior.serviceId !== serviceId) throw precondition('不能扩展原发布回调'); await checkCurrent(); return work(); }
      await input.assertAvailable(projectId);
      return withSharedDatabaseAdmissions(input.db, [NATIVE_REGISTRY_ADMISSION, releaseAdmissionKey(projectId)], async (protectedTx) => {
        await input.assertNativeRegistryAvailable?.();
        await input.assertAvailable(projectId);
        const sealed = await input.db.execute(sql`SELECT project_id FROM release.deletion_fences WHERE project_id=${projectId} UNION ALL SELECT project_id FROM release.project_admissions WHERE project_id=${projectId} AND sealed`);
        if (sealed.length) throw precondition('项目发布准入已永久封闭');
        const processIdentity = ReleaseCallbackProcessSchema.parse(await input.protectCurrent());
        if (processIdentity.pid !== process.pid) throw precondition('发布回调原 PID 与当前进程不符');
        assertSharedDatabaseAdmissionActive(input.db, releaseAdmissionKey(projectId));
        const backendPid = Number((await protectedTx.execute<{ pid: number }>(sql`SELECT pg_backend_pid() AS pid`))[0]!.pid), id = newResourceId(), exitKey = randomBytes(32).toString('hex');
        const birth = { id, kind: callback.kind, consumerId, projectId, serviceId, backendPid, process: processIdentity, inputDigest: callback.inputDigest, exitKeyDigest: jsonHash(exitKey) };
        await input.db.transaction(async (tx) => { await tx.execute(sql`INSERT INTO release.deletion_callbacks(id,kind,consumer_id,project_id,service_id,backend_pid,original_process,input_digest,exit_key_hash)
          VALUES(${id},${callback.kind},${consumerId},${projectId},${serviceId},${backendPid},${JSON.stringify(processIdentity)}::jsonb,${callback.inputDigest},${birth.exitKeyDigest})`); });
        const scope = { db: input.db, projectId, serviceId, active: true, ping: async () => { await protectedTx.execute(sql`SELECT 1`); } };
        return callbackScopes.run(scope, async () => {
          try { await checkCurrent(); return await work(); }
          finally {
            scope.active = false;
            await input.db.transaction(async (tx) => {
              await tx.execute(sql`SELECT set_config('crewstation.release_callback_exit',${exitKey},true)`);
              const changed = await tx.execute(sql`UPDATE release.deletion_callbacks SET exited_at=now(),exit_digest=${releaseCallbackIdentity({ ...birth, exited: false })} WHERE id=${id} AND exited_at IS NULL RETURNING id`);
              if (changed.length !== 1) throw precondition('原发布回调退出事实已经变化');
            });
          }
        });
      });
    } };
}
