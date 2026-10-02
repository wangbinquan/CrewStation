import { createWorker } from '@crewstation/queue';
import type { JobHandler } from '@crewstation/queue';
import { ResourceIdSchema } from '@crewstation/contracts';
import type { TaskRuntimeUseCaseDeps } from '../application/dependencies';
import { runDevelopmentParentEnding } from '../application/development/parent/run';
import { DEVELOPMENT_PARENT_ENDING_JOB_KIND } from '../ports/developmentParentEnding';

export function developmentParentEndingHandler(deps: TaskRuntimeUseCaseDeps): JobHandler {
  return async (job) => {
    const id = ResourceIdSchema.parse((job.payload as { endingId?: unknown }).endingId);
    await runDevelopmentParentEnding(deps, id, { jobId: job.id, fencingToken: job.fencingToken });
  };
}
export function developmentParentEndingWorker(db: Parameters<typeof createWorker>[0]['db'], deps: TaskRuntimeUseCaseDeps) {
  return createWorker({ db, kinds: [DEVELOPMENT_PARENT_ENDING_JOB_KIND], owner: `development-parent-${crypto.randomUUID()}`,
    handler: developmentParentEndingHandler(deps), logger: deps.logger, leaseSeconds: 120 });
}
