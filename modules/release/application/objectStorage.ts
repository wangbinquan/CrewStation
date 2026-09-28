import type { ReleaseId, ServiceId } from '@crewstation/contracts';
import type { RepositoryScope } from '../ports/unitOfWork';

/** Manifest of the verified source release, including standby slots; never use the current main branch. */
export function releaseObjectStorage(read: RepositoryScope) {
  return async (serviceId: ServiceId, releaseId: ReleaseId) => {
    const release = await read.releases.getById(releaseId);
    if (release?.serviceId !== serviceId || release.manifest?.kind !== 'DigitalWorker' || !release.manifest.spec.data) return undefined;
    return { planId: release.manifest.spec.data.objects.planId, fenced: release.manifest.spec.tasks?.executionControl === 'fenced' };
  };
}
