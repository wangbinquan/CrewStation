import type { Logger } from '@crewstation/kernel';

/** Retain the real iteration until it exits; a cleared timer alone cannot close its outstanding work. */
function lifecycleWorker(run: () => Promise<unknown>, onError: (error: unknown) => void, everyMs: number) {
  let timer: ReturnType<typeof setInterval> | undefined, pending: Promise<unknown> | undefined;
  const runOnce = () => pending ??= Promise.resolve().then(run).finally(() => { pending = undefined; });
  return { runOnce,
    start: () => { timer ??= setInterval(() => { void runOnce().catch(onError); }, everyMs); },
    stop: async () => { if (timer) clearInterval(timer); timer = undefined; await Promise.allSettled(pending ? [pending] : []); },
  };
}

/** Preserve existing first-tick timing and independent reconciliation/observation cadence. Neither iteration overlaps itself. */
export function runtimeLifecycleWorkers(logger: Logger, reconcile: () => Promise<unknown>, observeStartup: () => Promise<unknown>,
  intervals: { reconcileMs: number; observationMs: number } = { reconcileMs: 15_000, observationMs: 1_000 }) {
  return [
    lifecycleWorker(reconcile, (error) => logger.error('reconcile failed', { error: String(error) }), intervals.reconcileMs),
    lifecycleWorker(observeStartup, (error) => logger.error('startup observation failed', { error: String(error) }), intervals.observationMs),
  ];
}
