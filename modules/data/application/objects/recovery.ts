import type { ObjectRecoveryRepository } from '../../ports/objectRecovery';
import type { ObjectBackendPlane } from '../../ports/objectStorage';
import type { ObjectRequestRunner } from '../../ports/deletion/objectWork';
import { runObjectHandler } from './requestHandler';

export async function recoverObjectTransfers(deps: { requests?: ObjectRequestRunner; recovery: ObjectRecoveryRepository; plane: ObjectBackendPlane; owner: string }, signal: AbortSignal): Promise<void> {
  if (signal.aborted) return;
  if (deps.plane.inspectWrite) {
    const claim = await deps.recovery.claimInspection(deps.owner);
    if (claim) {
      await runObjectHandler(deps.requests,claim,'inspect',async () => {
      try { if (await deps.plane.inspectWrite!(claim, signal) === 'committed') await deps.recovery.inspected(claim); else await deps.recovery.deferInspection(claim); }
      catch { await deps.recovery.deferInspection(claim); }
      });
    }
  }
  if (signal.aborted) return;
  await deps.recovery.expireIdle();
  const garbage = await deps.recovery.claimGarbage(deps.owner);
  if (!garbage) return;
  await runObjectHandler(deps.requests,garbage,'remove',async () => {
  try { await deps.plane.remove(garbage, signal); await deps.recovery.completeGarbage(garbage); }
  catch { await deps.recovery.failGarbage(garbage); }
  });
}
