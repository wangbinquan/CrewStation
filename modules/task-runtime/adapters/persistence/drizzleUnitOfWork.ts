import { publishDomainEvent } from '@crewstation/eventbus';
import type { Logger } from '@crewstation/kernel';
import { noopLogger } from '@crewstation/kernel';
import type { Database, Executor } from '@crewstation/persistence';
import { enqueueJob } from '@crewstation/queue';
import { REBUILD_JOB_KIND } from '../../ports/rebuilds';
import { NATIVE_EXECUTION_JOB_KIND } from '../../ports/repositories';
import type { RepositoryScope, UnitOfWork } from '../../ports/unitOfWork';
import { drizzleAdmissionRepository, drizzleEnvironmentRepository } from './drizzleRepositories';
import { drizzleRebuildRepository } from './drizzleRebuildRepository';
import { ledgerEnvironmentRepository, syncEnvironmentLedger } from './ledgerProjection';
import type { EnvironmentLedger } from '../../ports/ledger';
import type { TaskEnvironment } from '../../domain/taskEnvironment';

/** 可选的资源台账投影（RFC-025）：给了就在每次环境落库的同一事务里同步台账。 */
export interface LedgerProjection {
  readonly ledger: EnvironmentLedger;
  readonly logger?: Logger;
}

export function scopeOver(executor: Executor, projection?: LedgerProjection): RepositoryScope {
  const environments = drizzleEnvironmentRepository(executor);
  const sync = projection ? (env: TaskEnvironment) => syncEnvironmentLedger(executor, projection.ledger, env, projection.logger ?? noopLogger) : undefined;
  return {
    environments: sync ? ledgerEnvironmentRepository(environments, sync) : environments,
    ...(sync ? { ledger: { sync } } : {}),
    admissions: drizzleAdmissionRepository(executor),
    rebuilds: drizzleRebuildRepository(executor),
    rebuildQueue: { enqueue: async (requestId) => { await enqueueJob(executor, REBUILD_JOB_KIND, { requestId }, { dedupKey: requestId, maxAttempts: 5 }); } },
    nativeQueue: { enqueue: async (taskId) => { await enqueueJob(executor, NATIVE_EXECUTION_JOB_KIND, { taskId }, { dedupKey: taskId, maxAttempts: 5 }); } },
    events: { publish: async (topic, payload) => { await publishDomainEvent(executor, topic, payload); } },
  };
}

export function drizzleUnitOfWork(db: Database, projection?: LedgerProjection): UnitOfWork {
  return { read: scopeOver(db, projection), run: (fn) => db.transaction((tx) => fn(scopeOver(tx, projection))) };
}
