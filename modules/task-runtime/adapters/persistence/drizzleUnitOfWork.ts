import { publishDomainEvent } from '@crewstation/eventbus';
import type { Database, Executor } from '@crewstation/persistence';
import { enqueueJob } from '@crewstation/queue';
import { REBUILD_JOB_KIND } from '../../ports/rebuilds';
import { NATIVE_EXECUTION_JOB_KIND } from '../../ports/repositories';
import type { RepositoryScope, UnitOfWork } from '../../ports/unitOfWork';
import { drizzleAdmissionRepository, drizzleEnvironmentRepository } from './drizzleRepositories';
import { drizzleRebuildRepository } from './drizzleRebuildRepository';

export function scopeOver(executor: Executor): RepositoryScope {
  return {
    environments: drizzleEnvironmentRepository(executor),
    admissions: drizzleAdmissionRepository(executor),
    rebuilds: drizzleRebuildRepository(executor),
    rebuildQueue: { enqueue: async (requestId) => { await enqueueJob(executor, REBUILD_JOB_KIND, { requestId }, { dedupKey: requestId, maxAttempts: 5 }); } },
    nativeQueue: { enqueue: async (taskId) => { await enqueueJob(executor, NATIVE_EXECUTION_JOB_KIND, { taskId }, { dedupKey: taskId, maxAttempts: 5 }); } },
    events: { publish: async (topic, payload) => { await publishDomainEvent(executor, topic, payload); } },
  };
}

export function drizzleUnitOfWork(db: Database): UnitOfWork {
  return { read: scopeOver(db), run: (fn) => db.transaction((tx) => fn(scopeOver(tx))) };
}
