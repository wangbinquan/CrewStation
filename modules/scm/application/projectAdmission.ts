import type { ServiceId } from '@crewstation/contracts';
import { newResourceId } from '@crewstation/kernel';
import type { ScmUseCaseDeps } from '../ports/useCaseDependencies';
import type { ScmExternalEffect, ScmWriteKind } from '../ports/repositoryWrites';
import { loadBinding } from './queryRepository';

export async function withScmServiceWrite<T>(deps: ScmUseCaseDeps, serviceId: ServiceId, kind: ScmWriteKind, work: () => Promise<T>): Promise<T> {
  const binding = await loadBinding(deps.uow, serviceId);
  return deps.uow.writes ? deps.uow.writes.withAdmission(binding.projectId, serviceId, kind, work) : work();
}

/** Intent commits before the remote call, result before ordinary metadata; no returned secret enters the journal. */
export async function scmExternalEffect<T>(deps: ScmUseCaseDeps, intent: Omit<ScmExternalEffect, 'intentId' | 'stage'>, work: () => Promise<T>, result: (value: T) => Omit<ScmExternalEffect, 'intentId' | 'stage' | 'kind'>): Promise<T> {
  const intentId = newResourceId();
  await deps.uow.writes?.record({ ...intent, intentId, stage: 'intent' });
  const value = await work();
  await deps.uow.writes?.record({ ...intent, ...result(value), intentId, stage: 'returned' });
  return value;
}

/** Actual source observation continues even when no credential expiry or new SCM call occurs. */
export function scmCallbackObserver(observe: () => Promise<void>, warn: (message: string) => void = () => undefined) {
  let timer: ReturnType<typeof setInterval> | undefined, pending: Promise<void> | undefined;
  const tick = () => {
    if (pending) return;
    pending = Promise.resolve().then(observe).catch(() => { warn('SCM callback source observation failed; original protection retained'); }).finally(() => { pending = undefined; });
  };
  return { start: () => { if (timer) return; timer = setInterval(tick, 10_000); timer.unref(); tick(); },
    stop: async () => { if (timer) clearInterval(timer); timer = undefined; await pending; } };
}
