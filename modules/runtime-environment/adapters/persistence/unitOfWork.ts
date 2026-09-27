import type { Database, Executor } from '@crewstation/persistence';
import { sql } from 'drizzle-orm';
import type { RepositoryScope, UnitOfWork } from '../../ports/unitOfWork';
import { imageRepository, revisionRepository, versionRepository } from './catalogRepositories';
import { buildRepository, validationRepository } from './executionRepositories';
import { developmentPolicyRepository, logRepository, referenceRepository } from './lifecycleRepositories';

export function imageRepositoryScope(db: Executor): RepositoryScope {
  return {
    images: imageRepository(db), revisions: revisionRepository(db), builds: buildRepository(db), versions: versionRepository(db), validations: validationRepository(db),
    references: referenceRepository(db), logs: logRepository(db), developmentPolicies: developmentPolicyRepository(db),
    lock: async (key) => { await db.execute(sql`select pg_advisory_xact_lock(hashtextextended(${'runtime-environment:' + key}, 0))`); },
  };
}
export const runtimeImageUnitOfWork = (db: Database): UnitOfWork => ({ read: imageRepositoryScope(db), run: (fn) => db.transaction((tx) => fn(imageRepositoryScope(tx))) });
