import { publishDomainEvent } from '@crewstation/eventbus';
import type { Logger } from '@crewstation/kernel';
import { isPlatformError, noopLogger, precondition, quotaExceeded } from '@crewstation/kernel';
import type { Database, Executor } from '@crewstation/persistence';
import { enqueueJob } from '@crewstation/queue';
import { REBUILD_JOB_KIND } from '../../ports/rebuilds';
import { NATIVE_EXECUTION_JOB_KIND } from '../../ports/repositories';
import type { AdmissionRepository } from '../../ports/repositories';
import type { RepositoryScope, TaskQuota, UnitOfWork } from '../../ports/unitOfWork';
import { drizzleAdmissionRepository, drizzleEnvironmentRepository } from './drizzleRepositories';
import { drizzleRebuildRepository } from './drizzleRebuildRepository';
import { authorizeTaskJob, drizzleDevelopmentParentEndingScope } from './developmentParentEndingScope';
import type { ParentEndingCommitCheck } from './developmentParentEndingScope';
import { admitEnvironment, findWorkloadRecord, ledgerEnvironmentRepository, syncEnvironmentLedger } from './ledgerProjection';
import type { EnvironmentLedger } from '../../ports/ledger';
import type { TaskEnvironment, WorkloadRender } from '../../domain/taskEnvironment';

/** 可选的资源台账投影（RFC-025）：给了就在每次环境落库的同一事务里同步台账。 */
export interface LedgerProjection {
  readonly ledger: EnvironmentLedger;
  readonly logger?: Logger;
  readonly preview?: (env: TaskEnvironment) => Promise<WorkloadRender['previewRoute']>;
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
    // 档位测试仍用系统哨兵计数；镜像用途验证由物理停止确认端口单独退额。
    release: async (env) => { if (env.kind === 'profile-test' && !env.render?.runtimeValidation) await admissions.release(env.projectId); },
    running: (projectId) => projection.ledger.occupancy(projectId),
  };
}

export function scopeOver(executor: Executor, projection?: LedgerProjection, commitChecks?: ParentEndingCommitCheck[]): RepositoryScope {
  const environments = drizzleEnvironmentRepository(executor), admissions = drizzleAdmissionRepository(executor);
  const sync = projection ? (env: TaskEnvironment) => syncEnvironmentLedger(executor, projection.ledger, env, projection.logger ?? noopLogger, projection.preview) : undefined;
  return {
    environments: sync ? ledgerEnvironmentRepository(environments, sync) : environments,
    ...(sync && projection ? { ledger: { sync, workload: (env: TaskEnvironment) => findWorkloadRecord(executor, projection.ledger, env) } } : {}),
    admissions,
    parentEnding: drizzleDevelopmentParentEndingScope(executor, commitChecks),
    nativeLease: { requireCurrent: (identity, taskId) => authorizeTaskJob(executor, commitChecks, identity, NATIVE_EXECUTION_JOB_KIND, { taskId }, 'execution_lease_lost') },
    quota: taskQuota(executor, admissions, projection),
    rebuilds: drizzleRebuildRepository(executor),
    rebuildQueue: { enqueue: async (requestId) => { await enqueueJob(executor, REBUILD_JOB_KIND, { requestId }, { dedupKey: requestId, maxAttempts: 5 }); } },
    nativeQueue: { enqueue: async (taskId) => { await enqueueJob(executor, NATIVE_EXECUTION_JOB_KIND, { taskId }, { dedupKey: taskId, maxAttempts: 5 }); } },
    events: { publish: async (topic, payload) => { await publishDomainEvent(executor, topic, payload); } },
  };
}

export function drizzleUnitOfWork(db: Database, projection?: LedgerProjection): UnitOfWork {
  return { read: scopeOver(db, projection), run: (fn) => db.transaction(async (tx) => {
    const checks: ParentEndingCommitCheck[] = [], result = await fn(scopeOver(tx, projection, checks));
    if (checks.length > 0) {
      if (projection) {
        const writer = projection.ledger.within(tx);
        if (!writer.flushDeferredChanges) throw precondition('父结束或恢复台账提交边界尚未装配', { code: 'development_parent_projection_boundary_missing' });
        await writer.flushDeferredChanges();
      }
      // Nothing after these checks may add a Project/Resource lock or any state write.
      for (const check of checks) await check();
    }
    return result;
  }) };
}
