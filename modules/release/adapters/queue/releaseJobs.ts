import type { Database } from '@crewstation/persistence';
import { enqueueJob } from '@crewstation/queue';
import type { ReleaseJobs } from '../../ports/delivery';

export const PIPELINE_JOB_KIND = 'release.pipeline';

export function queueReleaseJobs(db: Database): ReleaseJobs {
  return {
    enqueuePipelineStep: async (releaseId, step, delaySeconds) => {
      await enqueueJob(db, PIPELINE_JOB_KIND, { releaseId }, { dedupKey: `${releaseId}:${step}`, runAt: new Date(Date.now() + delaySeconds * 1000), maxAttempts: 3 });
    },
  };
}
