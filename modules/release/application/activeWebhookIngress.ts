import type { ServiceId } from '@crewstation/contracts';
import type { RepositoryScope } from '../ports/unitOfWork';

/** Only the current ready production manifest opens ingress, never a newly registered standby version. */
export function activeWebhookIngress(read: Pick<RepositoryScope, 'slots' | 'releases'>) {
  return async (serviceId: ServiceId): Promise<string | undefined> => {
    const slots = await read.slots.get(serviceId);
    if (!slots) return undefined;
    const active = slots[slots.active];
    if (active.state !== 'ready' || active.replicas < 1 || !active.releaseId) return undefined;
    const release = await read.releases.getById(active.releaseId);
    const manifest = release?.manifest;
    if (release?.status !== 'ready' || manifest?.kind !== 'EventProducer') return undefined;
    return manifest.spec.ingress.verification === 'none' ? undefined : manifest.spec.ingress.path;
  };
}
