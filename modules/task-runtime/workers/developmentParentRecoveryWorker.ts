import type { TaskRuntimeUseCaseDeps } from '../application/dependencies';
import { runtimeBackground } from '../application/deletion/background';
import type { RepositoryScope } from '../ports/unitOfWork';

function originalRecovery(scope: RepositoryScope) {
  if (!scope.parentEnding) throw new Error('原父恢复队列未装配');
  return scope.parentEnding;
}

async function refill(deps: TaskRuntimeUseCaseDeps) {
  if (!deps.projectWork) return deps.uow.run((scope) => originalRecovery(scope).recovery.refill(deps.clock.now(), 25));
  // Finish the global cursor transaction before acquiring any project admission. Each admitted callback covers the real enqueue COMMIT.
  const candidates = await deps.uow.run((scope) => originalRecovery(scope).recovery.scan(deps.clock.now(), 25));
  let count = 0;
  for (const candidate of candidates) count += await runtimeBackground(deps.projectWork, 'parent-recovery',
    candidate.kind === 'ending' ? 'parent-ending' : 'rebuild', candidate.requestId, async () => {
      await deps.uow.run(async (scope) => {
        if (candidate.kind === 'ending') await originalRecovery(scope).queue.enqueue(candidate.requestId);
        else await scope.rebuildQueue.enqueue(candidate.requestId);
      });
      return 1;
    }, 0, candidate);
  return count;
}

/** Restart-safe pending rows and two durable keysets; no overlap and no lifecycle/proof fabrication. */
export function developmentParentRecoveryWorker(deps: TaskRuntimeUseCaseDeps) {
  let timer: ReturnType<typeof setInterval> | undefined, pending: Promise<number> | undefined;
  const runOnce = () => pending ??= refill(deps).finally(() => { pending = undefined; });
  return { runOnce,
    start: () => { timer ??= setInterval(() => { void runOnce().catch((error: unknown) => deps.logger.warn('development parent recovery pending', { error: String(error) })); }, 2_000); },
    stop: async () => { if (timer) clearInterval(timer); timer = undefined; await pending; },
  };
}
