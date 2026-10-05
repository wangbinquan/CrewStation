import { allocationReceipts, imageCreationRequests, projectImagePolicies } from './tables';
import { conflict, jsonHash, newResourceId, precondition } from '@crewstation/kernel';
import type { Database, Executor } from '@crewstation/persistence';
import { assertSharedDatabaseAdmissionActive, withSharedDatabaseAdmissions } from '@crewstation/persistence';
import { NATIVE_REGISTRY_ADMISSION, ProjectIdSchema, ResourceIdSchema } from '@crewstation/contracts';
import { AsyncLocalStorage } from 'node:async_hooks';
import { randomBytes } from 'node:crypto';
import { z } from 'zod';
import { and, eq, sql } from 'drizzle-orm';
import type { RepositoryScope, RuntimeImageCallback, RuntimeImageCallbackProcess, RuntimeImageProjectAdmissions, UnitOfWork } from '../../ports/unitOfWork';
import { imageRepository, revisionRepository, versionRepository } from './catalogRepositories';
import { buildRepository, validationRepository } from './executionRepositories';
import { developmentPolicyRepository, logRepository, referenceRepository, runtimeImageProjectContent } from './lifecycleRepositories';

export function imageRepositoryScope(db: Executor): RepositoryScope {
  return {
    projectContent: (projectId) => runtimeImageProjectContent(db, projectId),
    allocationReceipts: {
      get: async (projectId, operationId) => (await db.select().from(allocationReceipts).where(and(eq(allocationReceipts.projectId, projectId), eq(allocationReceipts.operationId, operationId))))[0]?.payload,
      save: async (projectId, operationId, payload) => { await db.insert(allocationReceipts).values({ projectId, operationId, payload }); },
    },
    projectImagePolicies: {
      get: async (projectId) => (await db.select().from(projectImagePolicies).where(eq(projectImagePolicies.projectId, projectId)))[0]?.payload,
      save: async (policy) => { await db.insert(projectImagePolicies).values({ projectId: policy.projectId, payload: policy }).onConflictDoUpdate({ target: projectImagePolicies.projectId, set: { payload: policy } }); },
    },
    creations: {
      get: async (projectId, actorId, requestKey) => (await db.select().from(imageCreationRequests).where(and(eq(imageCreationRequests.projectId, projectId), eq(imageCreationRequests.actorId, actorId), eq(imageCreationRequests.requestKey, requestKey))))[0],
      insert: async (input) => { await db.insert(imageCreationRequests).values(input); },
    },
    images: imageRepository(db), revisions: revisionRepository(db), builds: buildRepository(db), versions: versionRepository(db), validations: validationRepository(db),
    references: referenceRepository(db), logs: logRepository(db), developmentPolicies: developmentPolicyRepository(db),
    lock: async (key) => {
      // 短事务并发重放须等前一次提交后读取同一回执；有界等待仍拒绝长期占用的锁。
      const previous = (await db.execute<{ value: string }>(sql`SELECT current_setting('lock_timeout') AS value`))[0]!.value;
      await db.execute(sql`SELECT set_config('lock_timeout','1s',true)`);
      try { await db.execute(sql`SELECT pg_advisory_xact_lock(hashtextextended(${'runtime-environment:' + key},0))`); }
      catch (error) { if (lockUnavailable(error)) throw conflict('运行镜像配置正在更新，请重试'); throw error; }
      await db.execute(sql`SELECT set_config('lock_timeout',${previous},true)`);
    },
  };
}
export const runtimeImageUnitOfWork = (db: Database, assertNativeRegistryAvailable?: () => Promise<void>): UnitOfWork => ({ read: imageRepositoryScope(db),
  run: (fn) => withSharedDatabaseAdmissions(db, [NATIVE_REGISTRY_ADMISSION], async () => {
    await assertNativeRegistryAvailable?.(); return db.transaction((tx) => fn(imageRepositoryScope(tx)));
  }) });

function lockUnavailable(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false;
  return 'code' in error && error.code === '55P03' || 'cause' in error && lockUnavailable(error.cause);
}

export const runtimeImageAdmissionKey = (id: string) => 'runtime-environment.project-admission:' + ProjectIdSchema.parse(id);
const callbackProcessSchema = z.object({ podUid: z.uuid(), containerId: z.string().regex(/^[a-z0-9]+:\/\/[a-f0-9]{64}$/), nodeUid: z.uuid(), nodeName: z.string().min(1).max(253) }).strict();
const callbackStartedAt = new Date(Date.now() - process.uptime() * 1000).toISOString();
const callbackScopes = new AsyncLocalStorage<{ db: Database; ids: readonly string[]; callback: RuntimeImageCallback; active: boolean; ping: () => Promise<void> }>();

/** Independent journal commits survive an outer SQL connection closing while the original callback still runs. */
export function runtimeImageProjectAdmissions(input: {
  db: Database; protectCurrent(): Promise<RuntimeImageCallbackProcess>; assertAvailable(projectId: string): Promise<void>; assertNativeRegistryAvailable?: () => Promise<void>;
}): RuntimeImageProjectAdmissions {
  const ids = (values: readonly string[]) => [...new Set(values.map((value) => ProjectIdSchema.parse(value)))].sort();
  const assertActive = (values: readonly string[]) => {
    const current = callbackScopes.getStore();
    if (!current?.active || current.db !== input.db || ids(values).some((id) => !current.ids.includes(id))) throw precondition('原运行镜像回调已退出或来源范围变化');
    assertSharedDatabaseAdmissionActive(input.db, NATIVE_REGISTRY_ADMISSION);
    for (const id of ids(values)) assertSharedDatabaseAdmissionActive(input.db, runtimeImageAdmissionKey(id));
  };
  const check = async (values: readonly string[]) => {
    assertActive(values);
    for (const id of ids(values)) await input.assertAvailable(id);
    // Heartbeats use the actual admitted connection, and never query an abandoned driver transaction.
    assertActive(values); await callbackScopes.getStore()!.ping(); assertActive(values);
  };
  return { assertActive, check, run: async (values, callback, work) => {
    const projects = ids(values);
    if (!ResourceIdSchema.safeParse(callback.id).success || !/^[a-f0-9]{64}$/.test(callback.inputDigest)) throw precondition('运行镜像回调缺少原输入身份');
    const current = callbackScopes.getStore();
    if (current?.db === input.db) {
      if (projects.some((id) => !current.ids.includes(id))) throw precondition('不能扩展原运行镜像回调');
      // Awaited source/initializer calls belong to this original callback and cannot add another project.
      await check(projects); return work();
    }
    for (const id of projects) await input.assertAvailable(id);
    return withSharedDatabaseAdmissions(input.db, [NATIVE_REGISTRY_ADMISSION, ...projects.map(runtimeImageAdmissionKey), ...projects.map(id => 'resources.project-admission:' + id)], async (protectedTx) => {
      await input.assertNativeRegistryAvailable?.();
      for (const id of projects) await input.assertAvailable(id);
      const projectKeys = sql.join(projects.map((id) => sql`${id}`), sql`,`);
      const sealed = projects.length ? await input.db.execute(sql`SELECT project_id FROM runtime_environment.deletion_fences WHERE project_id IN (${projectKeys})
        UNION ALL SELECT project_id FROM runtime_environment.project_admissions WHERE sealed AND project_id IN (${projectKeys})`) : [];
      if (sealed.length) throw precondition('运行镜像项目准入已永久封闭');
      const original = callbackProcessSchema.parse(await input.protectCurrent());
      for (const id of projects) assertSharedDatabaseAdmissionActive(input.db, runtimeImageAdmissionKey(id));
      const backendPid = Number((await protectedTx.execute<{ pid: number }>(sql`SELECT pg_backend_pid() AS pid`))[0]!.pid), id = newResourceId();
      const exitKey = randomBytes(32).toString('hex'), exitKeyDigest = jsonHash(exitKey);
      const identity = { id, kind: callback.kind, consumerId: callback.id, inputDigest: callback.inputDigest, projectIds: projects, backendPid, callbackPid: process.pid, callbackStartedAt, originalProcess: original, exitKeyDigest };
      await input.db.transaction(async (tx) => { await tx.execute(sql`INSERT INTO runtime_environment.deletion_callbacks(id,kind,consumer_id,project_ids,original_project_ids,backend_pid,callback_pid,callback_started_at,original_process,input_digest,exit_key_hash)
        VALUES(${id},${callback.kind},${callback.id},${JSON.stringify(projects)}::jsonb,${JSON.stringify(projects)}::jsonb,${backendPid},${process.pid},${callbackStartedAt},${JSON.stringify(original)}::jsonb,${callback.inputDigest},${exitKeyDigest})`); });
      const scope = { db: input.db, ids: projects, callback, active: true, ping: async () => { await protectedTx.execute(sql`SELECT 1`); } };
      return callbackScopes.run(scope, async () => {
        try { await check(projects); return await work(); }
        finally {
          // This runs only when the original work returns/throws, even if its outer driver rejected earlier.
          scope.active = false;
          await input.db.transaction(async (tx) => {
            await tx.execute(sql`SELECT set_config('crewstation.runtime_callback_exit',${exitKey},true)`);
            const changed = await tx.execute(sql`UPDATE runtime_environment.deletion_callbacks SET exited_at=now(),exit_digest=${jsonHash(identity)}
              WHERE id=${id} AND backend_pid=${backendPid} AND exited_at IS NULL AND recovery_digest IS NULL RETURNING id`);
            if (changed.length !== 1) throw precondition('原运行镜像回调退出事实已变化');
          });
        }
      });
    });
  } };
}
