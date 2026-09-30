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
    lock: async (key) => { const rows = await db.execute<{ acquired: boolean }>(sql`select pg_try_advisory_xact_lock(hashtextextended(${'runtime-environment:' + key}, 0)) as acquired`); if (!rows[0]?.acquired) throw conflict('运行镜像配置正在更新，请重试'); },
  };
}
export const runtimeImageUnitOfWork = (db: Database): UnitOfWork => ({ read: imageRepositoryScope(db), run: (fn) => db.transaction((tx) => fn(imageRepositoryScope(tx))) });
