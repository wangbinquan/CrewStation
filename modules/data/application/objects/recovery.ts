import type { ObjectRecoveryRepository } from '../../ports/objectRecovery';
import type { ObjectBackendPlane } from '../../ports/objectStorage';

export async function recoverObjectTransfers(deps: { recovery: ObjectRecoveryRepository; plane: ObjectBackendPlane; owner: string }, signal: AbortSignal): Promise<void> {
  if (signal.aborted) return;
  if (deps.plane.inspectWrite) {
    const claim = await deps.recovery.claimInspection(deps.owner);
    if (claim) {
      try { if (await deps.plane.inspectWrite(claim, signal) === 'committed') await deps.recovery.inspected(claim); else await deps.recovery.deferInspection(claim); }
      catch { await deps.recovery.deferInspection(claim); }
    }
  }
  if (signal.aborted) return;
  await deps.recovery.expireIdle();
  const garbage = await deps.recovery.claimGarbage(deps.owner);
  if (!garbage) return;
  try { await deps.plane.remove(garbage, signal); await deps.recovery.completeGarbage(garbage); }
  catch { await deps.recovery.failGarbage(garbage); }
}
