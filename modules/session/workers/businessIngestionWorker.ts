import type { TaskId } from '@crewstation/contracts';
import type { Logger } from '@crewstation/kernel';
import type { BusinessIngestionDeps } from '../application/businessIngestion';
import { ingestBusinessExecution } from '../application/businessIngestion';

export function businessIngestionWorker(deps: BusinessIngestionDeps & { connectedTasks(): TaskId[]; logger: Logger }) {
  let timer: ReturnType<typeof setInterval> | undefined, current: Promise<void> | undefined;
  const tick = async () => {
    await deps.store.expire();
    for (const stream of await deps.store.pending(deps.connectedTasks(), 20)) {
      try { await ingestBusinessExecution(deps, stream); }
      catch { deps.logger.debug('business event ingestion deferred', { taskId: stream.taskId, executionId: stream.receipt.executionId }); }
    }
  };
  const runOnce = () => current ??= tick().catch(() => { deps.logger.warn('business event ingestion unavailable'); }).finally(() => { current = undefined; });
  return {
    runOnce,
    start: () => { if (!timer) { void runOnce(); timer = setInterval(() => void runOnce(), 1000); } },
    stop: async () => { if (timer) clearInterval(timer); timer = undefined; await current; },
  };
}
