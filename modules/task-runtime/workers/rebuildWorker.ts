import { createWorker } from '@crewstation/queue';
import type { JobHandler } from '@crewstation/queue';
import { isPlatformError } from '@crewstation/kernel';
import type { RebuildExecutionDeps, RebuildHeartbeat } from '../application/rebuildExecution';
import { beginReplace, compensateRebuild, executeRebuild, rebuildFailureMessage, requireRebuildLease } from '../application/rebuildExecution';
import { executeDevelopmentParentRebuild } from '../application/development/parent/rebuildExecution';
import { publishDevelopmentParentRebuild } from '../application/development/parent/rebuildPublication';
import type { DevelopmentParentEndingJobLease } from '../ports/developmentParentEndingScope';
import { REBUILD_JOB_KIND } from '../ports/rebuilds';

async function runRebuild(deps: RebuildExecutionDeps, id: string, heartbeat: RebuildHeartbeat, identity: DevelopmentParentEndingJobLease): Promise<void> {
  const publication = await publishDevelopmentParentRebuild(deps, id, identity);
  if (publication === 'waiting') return;
  const original = await deps.uow.read.rebuilds.get(id);
  if (!original || original.creation === 'ledger') return;
  if (publication === 'published') { await executeDevelopmentParentRebuild(deps, id, heartbeat, identity); return; }
  await deps.uow.run(async (scope) => {
    await scope.admissions.lock(original.projectId);
    await requireRebuildLease(heartbeat);
    const record = await scope.rebuilds.get(id);
    if (record?.state === 'queued') await beginReplace(deps, scope, record);
  });
  await deps.uow.run(async (scope) => {
    await scope.admissions.lock(original.projectId);
    await requireRebuildLease(heartbeat);
    const record = await scope.rebuilds.get(id);
    const env = await scope.environments.getById(original.taskId);
    if (!record || record.state !== 'replacing' || !env || env.rebuildId !== id || env.state !== 'creating') return;
    if (record.failureReason) await compensateRebuild(deps, scope, record, env, heartbeat);
    else await executeRebuild(deps, scope, record, env, heartbeat);
  });
}

export function rebuildJobHandler(deps: RebuildExecutionDeps): JobHandler {
  return async (job, ctx) => {
    const id = (job.payload as { requestId?: unknown }).requestId;
    if (typeof id !== 'string') throw new Error('恢复作业缺少请求编号');
    try { await runRebuild(deps, id, ctx.heartbeat, { jobId: job.id, fencingToken: job.fencingToken }); }
    catch (error) {
      const original = await deps.uow.read.rebuilds.get(id);
      if (original && Object.hasOwn(original, 'developmentParentBinding')) throw new Error('原选中恢复仍等待实际作业接续');
      if (!original || !await ctx.heartbeat()) throw new Error('恢复作业已失效');
      await deps.uow.run(async (scope) => {
        await scope.admissions.lock(original.projectId);
        const record = await scope.rebuilds.get(id);
        if (!record || record.state !== 'replacing') return;
        const message = rebuildFailureMessage(error);
        const terminal = job.attempts >= job.maxAttempts || (isPlatformError(error) && error.kind === 'precondition');
        await scope.rebuilds.update({ ...record, updatedAt: deps.clock.now(), message,
          ...(terminal && !record.failureReason ? { failureReason: `${isPlatformError(error) && error.kind === 'precondition' ? error.message : '新环境准备失败，原工作卷保留'}；清理本次容器后可重新检查恢复` } : {}) });
      });
      // 不把集群响应体、环境变量或令牌写进队列错误记录。
      throw new Error('恢复作业尚未完成，将按记录继续重试或清理');
    }
  };
}

export function rebuildWorker(db: Parameters<typeof createWorker>[0]['db'], deps: RebuildExecutionDeps) {
  return createWorker({ db, kinds: [REBUILD_JOB_KIND], owner: `task-rebuild-${crypto.randomUUID()}`, handler: rebuildJobHandler(deps), logger: deps.logger, leaseSeconds: 120 });
}
