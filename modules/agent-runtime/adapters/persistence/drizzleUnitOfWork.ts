import type { Database, Executor } from '@crewstation/persistence';
import { enqueueJob } from '@crewstation/queue';
import { RUNTIME_CHECK_JOB_KIND } from '../../ports/repositories';
import type { RepositoryScope, UnitOfWork } from '../../ports/unitOfWork';
import { drizzleRuntimeCheckRepository, drizzleRuntimeConfigRepository, drizzleRuntimeCredentialRepository, drizzleRuntimeRevisionRepository } from './drizzleRepositories';

export function scopeOver(executor: Executor): RepositoryScope {
  return {
    configs: drizzleRuntimeConfigRepository(executor),
    revisions: drizzleRuntimeRevisionRepository(executor),
    credentials: drizzleRuntimeCredentialRepository(executor),
    checks: drizzleRuntimeCheckRepository(executor),
    checkQueue: { enqueue: async (checkId) => { await enqueueJob(executor, RUNTIME_CHECK_JOB_KIND, { checkId }, { dedupKey: checkId, maxAttempts: 3 }); } },
  };
}

export function drizzleUnitOfWork(db: Database): UnitOfWork {
  return { read: scopeOver(db), run: (fn) => db.transaction((tx) => fn(scopeOver(tx))) };
}
