import type { TaskRuntimeUseCaseDeps } from '../application/dependencies';

/** Restart-safe pending rows and two durable keysets; no overlap and no lifecycle/proof fabrication. */
export function developmentParentRecoveryWorker(deps: TaskRuntimeUseCaseDeps) {
  let timer: ReturnType<typeof setInterval> | undefined, pending: Promise<number> | undefined;
  const runOnce = () => pending ??= deps.uow.run(async (scope) => {
    if (!scope.parentEnding) throw new Error('原父恢复队列未装配');
    return scope.parentEnding.recovery.refill(deps.clock.now(), 25);
  }).finally(() => { pending = undefined; });
  return { runOnce,
    start: () => { timer ??= setInterval(() => { void runOnce().catch((error: unknown) => deps.logger.warn('development parent recovery pending', { error: String(error) })); }, 2_000); },
    stop: async () => { if (timer) clearInterval(timer); timer = undefined; await pending; },
  };
}
