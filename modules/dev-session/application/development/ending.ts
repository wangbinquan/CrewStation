import type { DevelopmentUsageDrainReason, TaskId } from '@crewstation/contracts';
import { DevelopmentUsageStopReceiptSchema } from '@crewstation/contracts';
import { jsonHash } from '@crewstation/kernel';
import { developmentEndingStored } from '../../domain/developmentEnding';
import type { DevelopmentEndingDeps } from '../../ports/developmentEnding';

export async function requestDevelopmentEnding(deps: DevelopmentEndingDeps, id: TaskId, reason: DevelopmentUsageDrainReason) {
  const observedAt = deps.clock.now().toISOString();
  const original = await deps.owner.get(id);
  if (!original || original.unsupported) return { kind: 'legacy' } as const;
  const stored = ['completed', 'error'].includes(reason) && original.binding ? developmentEndingStored(original.binding, await deps.session.registerDevelopmentUsage(original.binding)) : undefined;
  const receipt = stored?.receipt?.phase === 'finished' ? stored.receipt : undefined;
  return { kind: 'ending', job: await deps.store.request({ executionTaskId: id, expectedRegistration: original.binding, reason, observedAt, ...(receipt ? { receipt } : {}) }) } as const;
}
/** Independent bounded recovery, including ended/finalized starts. No timers or production wiring. */
export async function recoverDevelopmentEndings(deps: DevelopmentEndingDeps) {
  const observedAt = deps.clock.now().toISOString();
  const ids = await deps.store.takeRecoveryOwners(observedAt);
  let recovered = 0, waiting = 0;
  for (const id of ids) {
    try {
      const original = await deps.owner.get(id);
      if (!original?.binding || original.unsupported) { waiting++; continue; }
      const stored = developmentEndingStored(original.binding, await deps.session.registerDevelopmentUsage(original.binding)), receipt = stored.receipt;
      if (receipt?.phase !== 'finished' || !receipt.result) { waiting++; continue; }
      await deps.store.request({ executionTaskId: id, expectedRegistration: original.binding, reason: receipt.result, observedAt, receipt }); recovered++;
    } catch { waiting++; }
  }
  return { checked: ids.length, recovered, waiting };
}
/** Evidence-complete is not a cleanup permit. All transport I/O is outside owner transactions. */
export async function advanceDevelopmentEnding(deps: DevelopmentEndingDeps, id: TaskId) {
  const lease = await deps.store.claim(id, deps.clock.now().toISOString());
  if (!lease) return { kind: 'busy' } as const;
  try {
    const original = await deps.owner.get(id);
    if (!original?.binding) { await deps.store.retry(lease, deps.clock.now().toISOString()); return { kind: 'waiting', reason: 'unbound' } as const; }
    if (original.unsupported || jsonHash(original.binding) !== jsonHash(lease.registration)) throw new Error('Original admission changed');
    const binding = original.binding, registered = developmentEndingStored(binding, await deps.session.registerDevelopmentUsage(binding));
    let stop = null;
    try {
      const parsed = DevelopmentUsageStopReceiptSchema.safeParse(await deps.session.sendCommand(id, {
        id: 'development-stop-' + id, type: 'stopDevelopmentAgent', podUid: binding.podUid,
        admission: { intent: original.intent, key: binding.key, digestNonce: original.digestNonce },
      }));
      if (parsed.success) stop = parsed.data;
    } catch { /* A lost ACK does not prove exit, data loss, or rejection. */ }
    const stored = developmentEndingStored(binding, await deps.session.requestDevelopmentUsageDrain(id, binding.key, registered.drainReason ?? lease.job.firstReason));
    const job = await deps.store.commit(lease, { observedAt: deps.clock.now().toISOString(), stored, stop });
    return job ? { kind: 'ending', job } as const : { kind: 'waiting', reason: 'stale-lease' } as const;
  } catch {
    await deps.store.retry(lease, deps.clock.now().toISOString()).catch(() => false);
    return { kind: 'waiting', reason: 'retry' } as const;
  }
}
