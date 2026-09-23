import { publishDomainEvent } from '@crewstation/eventbus';
import type { Logger } from '@crewstation/kernel';
import { isPlatformError, noopLogger, quotaExceeded } from '@crewstation/kernel';
import type { Database, Executor } from '@crewstation/persistence';
import { enqueueJob } from '@crewstation/queue';
import { REBUILD_JOB_KIND } from '../../ports/rebuilds';
import { NATIVE_EXECUTION_JOB_KIND } from '../../ports/repositories';
import type { AdmissionRepository } from '../../ports/repositories';
import type { RepositoryScope, TaskQuota, UnitOfWork } from '../../ports/unitOfWork';
import { drizzleAdmissionRepository, drizzleEnvironmentRepository } from './drizzleRepositories';
import { drizzleRebuildRepository } from './drizzleRebuildRepository';
import { admitEnvironment, findWorkloadRecord, ledgerEnvironmentRepository, syncEnvironmentLedger } from './ledgerProjection';
import type { EnvironmentLedger } from '../../ports/ledger';
import type { TaskEnvironment } from '../../domain/taskEnvironment';

/** 可选的资源台账投影（RFC-025）：给了就在每次环境落库的同一事务里同步台账。 */
export interface LedgerProjection {
  readonly ledger: EnvironmentLedger;
  readonly logger?: Logger;
}

/** 额度（D31）：配了台账就经台账受理、按阶段数（不做减法）；没配就用本模块的计数器。 */
function taskQuota(executor: Executor, admissions: AdmissionRepository, projection?: LedgerProjection): TaskQuota {
  if (!projection) {
    return {
      acquire: async (env, limit, message) => { if (!(await admissions.tryAcquire(env.projectId, limit))) throw quotaExceeded(message, { projectId: env.projectId, limit }); },
      release: (env) => admissions.release(env.projectId),
      running: (projectId) => admissions.running(projectId),
    };
  }
  return {
    acquire: async (env, _limit, message) => {
      try { await admitEnvironment(executor, projection.ledger, env); } catch (error) {
        if (isPlatformError(error) && error.kind === 'quota_exceeded') throw quotaExceeded(message, error.details);
        throw error;
      }
    },
    release: async () => undefined,
    running: (projectId) => projection.ledger.occupancy(projectId),
  };
}

export function scopeOver(executor: Executor, projection?: LedgerProjection): RepositoryScope {
  const environments = drizzleEnvironmentRepository(executor), admissions = drizzleAdmissionRepository(executor);
  const sync = projection ? (env: TaskEnvironment) => syncEnvironmentLedger(executor, projection.ledger, env, projection.logger ?? noopLogger) : undefined;
  return {
    environments: sync ? ledgerEnvironmentRepository(environments, sync) : environments,
    ...(sync && projection ? { ledger: { sync, workload: (env: TaskEnvironment) => findWorkloadRecord(executor, projection.ledger, env) } } : {}),
    admissions,
    quota: taskQuota(executor, admissions, projection),
    rebuilds: drizzleRebuildRepository(executor),
    rebuildQueue: { enqueue: async (requestId) => { await enqueueJob(executor, REBUILD_JOB_KIND, { requestId }, { dedupKey: requestId, maxAttempts: 5 }); } },
    nativeQueue: { enqueue: async (taskId) => { await enqueueJob(executor, NATIVE_EXECUTION_JOB_KIND, { taskId }, { dedupKey: taskId, maxAttempts: 5 }); } },
    events: { publish: async (topic, payload) => { await publishDomainEvent(executor, topic, payload); } },
  };
}

export function drizzleUnitOfWork(db: Database, projection?: LedgerProjection): UnitOfWork {
  return { read: scopeOver(db, projection), run: (fn) => db.transaction((tx) => fn(scopeOver(tx, projection))) };
}
