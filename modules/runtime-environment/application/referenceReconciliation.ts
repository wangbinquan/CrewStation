import { imageContentDigest } from '../domain/contentDigest';
import { versionLock } from './compatibility';
import type { RuntimeImageDeps } from './dependencies';

/** No TTL deletion: only an irreversible owner proof can release an unchanged reference. */
export function runtimeImageReferenceReconciliation(deps: Pick<RuntimeImageDeps, 'uow' | 'clock' | 'referenceOwners'>) {
  let cursor: string | undefined;
  return async (): Promise<number> => {
    if (!deps.referenceOwners) return 0;
    const candidates = await deps.uow.read.references.scan(cursor, 20);
    cursor = candidates.length === 20 ? candidates.at(-1)!.id : undefined;
    let released = 0;
    for (const candidate of candidates) {
      if (['development-config', 'validation'].includes(candidate.ownerType)) continue;
      if (candidate.state === 'reserved' && (!candidate.expiresAt || candidate.expiresAt > deps.clock.now().toISOString())) continue;
      try {
        const proof = await deps.referenceOwners.inspect({ projectId: candidate.projectId, versionId: candidate.versionId, ownerType: candidate.ownerType, ownerId: candidate.ownerId });
        if (proof !== 'released') continue;
        const version = await deps.uow.read.versions.get(candidate.versionId);
        if (!version) continue;
        released += await deps.uow.run(async (scope) => {
          await scope.lock(versionLock(version));
          const current = await scope.references.get(candidate.versionId, candidate.ownerType, candidate.ownerId);
          // Confirmation or a replacement during the proof query requires a new observation.
          if (!current || imageContentDigest(current) !== imageContentDigest(candidate)) return 0;
          await scope.references.remove(current.id); return 1;
        });
      } catch {
        // An unavailable proof or database keeps the artifact protected for the next scan.
      }
    }
    return released;
  };
}
