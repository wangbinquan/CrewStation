import type { Logger } from '@crewstation/kernel';
import { createWorker, enqueueJob } from '@crewstation/queue';
import type { WorkerOptions } from '@crewstation/queue';
import { ResourceIdSchema } from '@crewstation/contracts';
import type { ProjectDeletionController } from '../api/deletion';
import type { StartupTask } from './namespaceReapply';
import type { ProjectDeletionIntents } from '../ports/projectDeletions';

export const PROJECT_DELETION_JOB_KIND = 'provisioning.project-deletion';
export function deletionEnqueue(db: WorkerOptions['db'], coordinate?: ProjectDeletionIntents['coordinate']) {
  return async (operationId: string) => {
    ResourceIdSchema.parse(operationId);
    const write = async (executor: object) => { await enqueueJob(executor as Parameters<typeof enqueueJob>[0], PROJECT_DELETION_JOB_KIND, { operationId }, { dedupKey: operationId, maxAttempts: 5 }); };
    if (coordinate) await coordinate(operationId, write); else await write(db);
  };
}
export function projectDeletionRuntime(db: WorkerOptions['db'], api: ProjectDeletionController, owner: string, logger: Logger) {
  const worker = createWorker({ db, owner: `${owner}.deletion`, kinds: [PROJECT_DELETION_JOB_KIND], concurrency: 1, leaseSeconds: 600, logger,
    handler: async (job, context) => {
      const operationId = ResourceIdSchema.parse((job.payload as { operationId?: unknown })?.operationId); await api.advance(operationId, context.heartbeat);
    } });
  let timer: ReturnType<typeof setTimeout> | undefined, running = false, pending: Promise<void> | undefined;
  const scan = () => {
    pending = api.recover().catch(() => logger.warn('project deletion recovery scan failed; original operations retained')).finally(() => {
      pending = undefined; if (running) timer = setTimeout(scan, 15_000);
    });
  };
  const recovery: StartupTask = {
    start: () => { if (running) return; running = true; scan(); },
    stop: async () => { running = false; if (timer) clearTimeout(timer); await pending; },
  };
  return { worker, recovery };
}
