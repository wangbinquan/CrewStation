import type { ServiceId } from '@crewstation/contracts';
import type { ObjectCatalogRepository } from '../../ports/objectStorage';

/** Admission checks current production storage; an outage never prevents querying an already accepted operation. */
export function taskStorageStatus(catalog: ObjectCatalogRepository, contract: { check(): Promise<{ enabled: boolean }> }) {
  return async (serviceId: ServiceId): Promise<{ available: boolean; reason: string | null }> => {
    if (!(await contract.check()).enabled) return { available: false, reason: 'storage_contract_unavailable' };
    const space = await catalog.serviceSpace(serviceId, 'production');
    if (!space?.enabled) return { available: false, reason: 'object_space_unavailable' };
    const backend = await catalog.backend(space.backendId);
    if (!backend || !['active', 'no-new-spaces'].includes(backend.state) || backend.health !== 'ready' || !backend.observedAt || Date.now() - Date.parse(backend.observedAt) > 120_000) return { available: false, reason: 'object_backend_unavailable' };
    return { available: true, reason: null };
  };
}
