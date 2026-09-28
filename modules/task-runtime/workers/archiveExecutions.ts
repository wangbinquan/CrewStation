import type { Logger } from '@crewstation/kernel';

/** Bounded pages and one in-flight tick per process; the store serializes mutations across replicas. */
export function archiveExecutionWorker(run: () => Promise<void>, logger: Logger) {
  let timer: ReturnType<typeof setInterval> | undefined, pending: Promise<void> | undefined;
  const tick = () => { pending ??= run().catch((error: unknown) => { logger.warn('archive reconciliation failed', { error: String(error) }); }).finally(() => { pending = undefined; }); };
  return { start: () => { tick(); timer ??= setInterval(tick, 5000); }, stop: async () => { clearInterval(timer); timer = undefined; await pending; } };
}
