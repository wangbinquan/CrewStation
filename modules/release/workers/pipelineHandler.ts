import type { ReleaseId } from '@crewstation/contracts';
import type { JobHandler } from '@crewstation/queue';
import type { ReleaseModuleApi } from '../api/moduleApi';
import type { ReleaseJobs } from '../ports/delivery';

export const PIPELINE_JOB_KIND = 'release.pipeline';

/** 每个任务推进一步；未结束就以新的 step 键重新入队，避免长事务与长租约。工作器本身由 wiring 绑定数据库创建。 */
export function pipelineJobHandler(api: Pick<ReleaseModuleApi, 'runPipelineStep'>, jobs: ReleaseJobs): JobHandler {
  return async (job) => {
    const { releaseId } = job.payload as { releaseId: ReleaseId };
    const result = await api.runPipelineStep(releaseId);
    if (!result.done) await jobs.enqueuePipelineStep(releaseId, job.id, result.retryAfterSeconds);
  };
}
