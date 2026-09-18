import type { Database, Executor } from '@crewstation/persistence';
import { enqueueJob } from '@crewstation/queue';
import { PROFILE_TEST_JOB_KIND } from '../../ports/repositories';
import type { RepositoryScope, UnitOfWork } from '../../ports/unitOfWork';
import { drizzleCredentialRepository, drizzleProfileRepository, drizzleRevisionRepository, drizzleTestRepository } from './drizzleRepositories';

export function scopeOver(executor: Executor): RepositoryScope {
  return {
    profiles: drizzleProfileRepository(executor),
    revisions: drizzleRevisionRepository(executor),
    credentials: drizzleCredentialRepository(executor),
    tests: drizzleTestRepository(executor),
    testQueue: { enqueue: async (testId) => { await enqueueJob(executor, PROFILE_TEST_JOB_KIND, { testId }, { dedupKey: testId, maxAttempts: 3 }); } },
  };
}

export function drizzleUnitOfWork(db: Database): UnitOfWork {
  return { read: scopeOver(db), run: (fn) => db.transaction((tx) => fn(scopeOver(tx))) };
}
