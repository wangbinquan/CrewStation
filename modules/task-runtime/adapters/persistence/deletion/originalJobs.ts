import type { Database } from '@crewstation/persistence';
import { claimOriginalCleanupJob, completeJob, heartbeatJob } from '@crewstation/queue';
import { precondition } from '@crewstation/kernel';
import type { RuntimeOriginalJobs } from '../../../ports/deletion/originalStop';
import type { RuntimeWorkSources } from '../../../ports/deletion/work';
import { NATIVE_EXECUTION_JOB_KIND } from '../../../ports/repositories';
import { runtimeWorkOrigin } from './workOrigin';

/** Every call runs inside the retained original Task callback; the queue keeps its ordinary numeric fence. */
export function runtimeOriginalJobs(db: Database, sources: RuntimeWorkSources, options: { leaseSeconds?: number; renewEveryMs?: number } = {}): RuntimeOriginalJobs {
  const leaseSeconds = options.leaseSeconds ?? 120, renewEveryMs = options.renewEveryMs ?? 40_000;
  if (!Number.isSafeInteger(leaseSeconds) || leaseSeconds < 1 || !Number.isSafeInteger(renewEveryMs) || renewEveryMs < 10 || renewEveryMs >= leaseSeconds * 1000)
    throw precondition('原清理作业续租窗口无效');
  return { run: async (context, taskId, callback) => {
    await sources.assertGrant(context);
    if (context.phase !== 'stop') throw precondition('原作业接续只接受项目删除停止阶段');
    const origin = await runtimeWorkOrigin(db, sources, 'task', taskId);
    if (origin.scope !== 'project' || origin.projectIds[0] !== context.target.id) throw precondition('原清理作业不属于已确认项目');
    const job = await claimOriginalCleanupJob(db, { kind: NATIVE_EXECUTION_JOB_KIND, dedupKey: taskId, payload: { taskId } },
      'project-deletion:' + context.operationId, leaseSeconds);
    if (!job) return { claimed: false };
    const identity = { jobId: job.id, fencingToken: job.fencingToken };
    let failure: unknown, renewal: Promise<void> | undefined;
    const heartbeat = async () => {
      if (failure) throw failure;
      await sources.assertGrant(context);
      const renewed = await heartbeatJob(db, job.id, job.fencingToken, leaseSeconds);
      await sources.assertGrant(context);
      return renewed;
    };
    const timer = setInterval(() => {
      if (renewal || failure) return;
      renewal = heartbeat().then((renewed) => { if (!renewed) failure = precondition('原清理作业的租约已失效'); })
        .catch((error: unknown) => { failure = error; }).finally(() => { renewal = undefined; });
    }, renewEveryMs);
    try {
      await sources.assertGrant(context);
      const value = await callback(identity, heartbeat);
      clearInterval(timer); await renewal;
      if (failure) throw failure;
      await sources.assertGrant(context);
      return { claimed: true, value };
    } finally {
      clearInterval(timer); await renewal;
      // Settlement ends this delivery attempt, not the cleanup barrier; the next grant can resume this same row.
      if (!await completeJob(db, job.id, job.fencingToken)) throw precondition('原清理作业的租约已失效');
    }
  } };
}
