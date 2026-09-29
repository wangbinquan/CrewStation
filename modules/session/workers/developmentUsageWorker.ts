import type { TaskId } from '@crewstation/contracts';
import type { Logger } from '@crewstation/kernel';
import type { DevelopmentUsageIngestionDeps } from '../application/developmentUsageIngestion';
import { ingestDevelopmentUsage } from '../application/developmentUsageIngestion';

/** Separate scheduling prevents a failing business journal from starving development numeric copies. */
export function developmentUsageWorker(deps: DevelopmentUsageIngestionDeps & { connectedTasks(): TaskId[]; logger: Logger }) {
  let timer: ReturnType<typeof setInterval> | undefined, current: Promise<void> | undefined;
  const tick = async () => {
    for (const stream of await deps.store.pending(deps.connectedTasks(), 20)) {
      try { await ingestDevelopmentUsage(deps, stream); }
      catch { deps.logger.debug('development usage ingestion deferred', { taskId: stream.registration.runtimeTaskId }); }
    }
  };
  const runOnce = () => current ??= tick().catch(() => { deps.logger.warn('development usage ingestion unavailable'); }).finally(() => { current = undefined; });
  return { runOnce,
    start: () => { if (!timer) { void runOnce(); timer = setInterval(() => void runOnce(), 1000); } },
    stop: async () => { if (timer) clearInterval(timer); timer = undefined; await current; },
  };
}
