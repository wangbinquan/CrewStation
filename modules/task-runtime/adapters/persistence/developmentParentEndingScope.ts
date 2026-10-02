import { precondition } from '@crewstation/kernel';
import type { Executor } from '@crewstation/persistence';
import { enqueueJob, lockJobLease } from '@crewstation/queue';
import { DEVELOPMENT_PARENT_ENDING_JOB_KIND } from '../../ports/developmentParentEnding';
import type { DevelopmentParentEndingJobLease, DevelopmentParentEndingScope } from '../../ports/developmentParentEndingScope';
import { REBUILD_JOB_KIND } from '../../ports/rebuilds';
import { developmentParentRecovery } from './developmentParentRecovery';
import { drizzleDevelopmentParentEndings, drizzleDevelopmentParentRebuildClaims } from './developmentParentEndings';
import { drizzleDevelopmentParentEndingChildren, drizzleDevelopmentParentEndingObjects } from './developmentParentEndingChildren';

export type ParentEndingCommitCheck = () => Promise<void>;
export async function authorizeTaskJob(db: Executor, checks: ParentEndingCommitCheck[] | undefined, identity: DevelopmentParentEndingJobLease,
  kind: string, payload: Readonly<Record<string, string>>, failureCode = 'development_parent_job_lease_lost'): Promise<void> {
  if (!checks) throw precondition('父结束或恢复作业授权只能在提交事务内核验', { code: 'development_parent_job_transaction_required' });
  const jobId = identity.jobId, fencingToken = identity.fencingToken;
  const check = async () => {
    if (!await lockJobLease(db, jobId, fencingToken, { kind, payload }))
      throw precondition('父结束或恢复作业租约已失效', { code: failureCode });
  };
  await check(); checks.push(check);
}
export function drizzleDevelopmentParentEndingScope(db: Executor, checks?: ParentEndingCommitCheck[]): DevelopmentParentEndingScope {
  return { recovery: developmentParentRecovery(db, checks !== undefined), endings: drizzleDevelopmentParentEndings(db), children: drizzleDevelopmentParentEndingChildren(db),
    objects: drizzleDevelopmentParentEndingObjects(db), claims: drizzleDevelopmentParentRebuildClaims(db),
    queue: { enqueue: async (endingId) => { await enqueueJob(db, DEVELOPMENT_PARENT_ENDING_JOB_KIND, { endingId }, { dedupKey: endingId, maxAttempts: 5 }); } },
    lease: { requireCurrent: (identity, endingId) => authorizeTaskJob(db, checks, identity, DEVELOPMENT_PARENT_ENDING_JOB_KIND, { endingId }) },
    rebuildLease: { requireCurrent: (identity, requestId) => authorizeTaskJob(db, checks, identity, REBUILD_JOB_KIND, { requestId }) } };
}
