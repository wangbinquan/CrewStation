import { RuntimeCheckIdSchema } from '@crewstation/contracts';
import type { Logger } from '@crewstation/kernel';
import { createWorker } from '@crewstation/queue';
import type { JobHandler, WorkerOptions } from '@crewstation/queue';
import type { AgentRuntimeModuleApi } from '../api/moduleApi';
import { RUNTIME_CHECK_JOB_KIND } from '../ports/repositories';

/** 检查作业：一次认领跑到终态；执行器自己保证脚本不重跑，作业失败只记录不复活。 */
export function checkJobHandler(api: Pick<AgentRuntimeModuleApi, 'runQueuedCheck'>): JobHandler {
  return async (job, ctx) => {
    const checkId = RuntimeCheckIdSchema.parse((job.payload as { checkId?: unknown }).checkId);
    await api.runQueuedCheck(checkId, ctx.heartbeat);
  };
}

export function checkWorker(db: WorkerOptions['db'], api: Pick<AgentRuntimeModuleApi, 'runQueuedCheck'>, logger: Logger) {
  return createWorker({ db, kinds: [RUNTIME_CHECK_JOB_KIND], owner: `agent-runtime-check-${crypto.randomUUID()}`, handler: checkJobHandler(api), logger, leaseSeconds: 300 });
}
