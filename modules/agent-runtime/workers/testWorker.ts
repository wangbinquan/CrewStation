import { ProfileTestIdSchema } from '@crewstation/contracts';
import type { Logger } from '@crewstation/kernel';
import { createWorker } from '@crewstation/queue';
import type { JobHandler, WorkerOptions } from '@crewstation/queue';
import type { AgentRuntimeModuleApi } from '../api/moduleApi';
import { PROFILE_TEST_JOB_KIND } from '../ports/repositories';

/** 测试作业：一次认领跑到终态；执行器自己保证脚本不重跑，作业失败只记录不复活。 */
export function testJobHandler(api: Pick<AgentRuntimeModuleApi, 'runQueuedTest'>): JobHandler {
  return async (job, ctx) => {
    const testId = ProfileTestIdSchema.parse((job.payload as { testId?: unknown }).testId);
    await api.runQueuedTest(testId, ctx.heartbeat);
  };
}

export function testWorker(db: WorkerOptions['db'], api: Pick<AgentRuntimeModuleApi, 'runQueuedTest'>, logger: Logger) {
  return createWorker({ db, kinds: [PROFILE_TEST_JOB_KIND], owner: `agent-runtime-test-${crypto.randomUUID()}`, handler: testJobHandler(api), logger, leaseSeconds: 300 });
}
