import type { ObjectTransferOwners } from '../ports/objectTransferOwners';
import type { Logger } from '@crewstation/kernel';
import { periodicJob } from '@crewstation/resource-runtime';
import { probeObjectBackends, verifyNextObject } from '../application/objectMaintenance';
import type { ObjectBackendPlane, ObjectCatalogRepository, ObjectUploadRepository } from '../ports/objectStorage';
import type { ObjectContentRepository } from '../ports/objectContent';
import type { ObjectRecoveryRepository } from '../ports/objectRecovery';
import { recoverObjectTransfers } from '../application/objects/recovery';
import type { ObjectRequestRunner } from '../ports/deletion/objectWork';
import { runObjectHandler } from '../application/objects/requestHandler';

export function objectMaintenanceWorkers(deps: { requests?: ObjectRequestRunner; sweepRequests?: () => Promise<void>; transferOwners?: ObjectTransferOwners; recoverReads?: (podUid: string, proof: string) => Promise<void>; catalog: ObjectCatalogRepository; uploads: ObjectUploadRepository; content: ObjectContentRepository; recovery?: ObjectRecoveryRepository; plane: ObjectBackendPlane; owner: string; logger: Logger }) {
  const worker = (run: (signal: AbortSignal) => Promise<void>, everyMs: number) => {
    let abort = new AbortController();
    const job = periodicJob(() => run(abort.signal), () => deps.logger.warn('object storage maintenance retry pending'), everyMs);
    return { start: () => { if (abort.signal.aborted) abort = new AbortController(); job.start(); }, stop: async () => { abort.abort(); await job.stop(); } };
  };
  return [
    ...(deps.sweepRequests ? [worker(deps.sweepRequests,5000)] : []),
    ...(deps.transferOwners && deps.recoverReads ? [worker(() => deps.transferOwners!.sweep(deps.recoverReads!), 5000)] : []),
    ...(deps.recovery ? [worker((signal) => recoverObjectTransfers({ ...deps, recovery: deps.recovery! }, signal), 5000)] : []),
    worker((signal) => probeObjectBackends(deps.catalog, deps.plane, signal), 30_000),
    worker(async (signal) => {
      await deps.uploads.recoverExpired();
      for (let n = 0; n < 4 && !signal.aborted; n++) if (!await verifyNextObject(deps, signal)) break;
    }, 250),
    worker(async (signal) => {
      const claim = await deps.content.claimDelete(deps.owner);
      if (!claim || signal.aborted) return;
      await runObjectHandler(deps.requests,claim,'remove',async () => {
      try { await deps.plane.remove(claim, signal); await deps.content.completeDelete(claim); }
      catch { await deps.content.failDelete(claim, 'object_deletion_unconfirmed'); }
      });
    }, 2000),
  ];
}
