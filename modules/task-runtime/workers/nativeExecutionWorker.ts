import { TaskIdSchema } from '@crewstation/contracts';
import { isPlatformError } from '@crewstation/kernel';
import { createWorker } from '@crewstation/queue';
import type { JobHandler } from '@crewstation/queue';
import type { NativeExecutionDeps } from '../application/nativeExecution';
import { failPreparation, preparationFailureReason, requireExecutionLease, runNativeExecution } from '../application/nativeExecution';
import { NATIVE_EXECUTION_JOB_KIND } from '../ports/repositories';

export function nativeExecutionJobHandler(deps: NativeExecutionDeps): JobHandler {
  return async (job, ctx) => {
    const taskId = TaskIdSchema.parse((job.payload as { taskId?: unknown }).taskId);
    try { await runNativeExecution(deps, taskId, ctx.heartbeat, { jobId: job.id, fencingToken: job.fencingToken }); }
    catch (error) {
      const original = await deps.uow.read.environments.getById(taskId);
      if (!original) return;
      await requireExecutionLease(ctx.heartbeat);
      await deps.uow.run(async (scope) => {
        await scope.admissions.lock(original.projectId);
        if (original.render?.developmentUsageProtection !== undefined) {
          if (!scope.nativeLease) throw new Error('开发执行作业事务保护不可用');
          await scope.nativeLease.requireCurrent({ jobId: job.id, fencingToken: job.fencingToken }, taskId);
        } else await requireExecutionLease(ctx.heartbeat);
        const env = await scope.environments.getById(taskId);
        if (!env || env.native?.state !== 'queued') return;
        if (job.attempts >= job.maxAttempts || (isPlatformError(error) && error.kind === 'precondition')) {
          const precondition = isPlatformError(error) && error.kind === 'precondition';
          await failPreparation(scope, env, deps.clock.now(), isPlatformError(error) && error.kind === 'precondition' ? error.message : preparationFailureReason(env), precondition);
          if (env.render?.developmentUsageProtection !== undefined) await scope.nativeLease!.requireCurrent({ jobId: job.id, fencingToken: job.fencingToken }, taskId);
        }
      });
      throw new Error('Agent 执行环境操作尚未完成，将按持久状态继续准备或清理');
    }
  };
}

export function nativeExecutionWorker(db: Parameters<typeof createWorker>[0]['db'], deps: NativeExecutionDeps) {
  return createWorker({ db, kinds: [NATIVE_EXECUTION_JOB_KIND], owner: `native-execution-${crypto.randomUUID()}`, handler: nativeExecutionJobHandler(deps), logger: deps.logger, leaseSeconds: 120 });
}
