import { imageCreationRequests, projectImagePolicies } from './tables';
import { allocationReceipts } from './allocationTable';
import { conflict } from '@crewstation/kernel';
import type { Database, Executor } from '@crewstation/persistence';
import { and, eq, sql } from 'drizzle-orm';
import type { RepositoryScope, UnitOfWork } from '../../ports/unitOfWork';
import { imageRepository, revisionRepository, versionRepository } from './catalogRepositories';
import { buildRepository, validationRepository } from './executionRepositories';
import { developmentPolicyRepository, logRepository, referenceRepository } from './lifecycleRepositories';

export function imageRepositoryScope(db: Executor): RepositoryScope {
  return {
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
export const runtimeImageUnitOfWork = (db: Database): UnitOfWork => ({ read: imageRepositoryScope(db), run: (fn) => db.transaction((tx) => fn(imageRepositoryScope(tx))) });

function lockUnavailable(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false;
  return 'code' in error && error.code === '55P03' || 'cause' in error && lockUnavailable(error.cause);
}
