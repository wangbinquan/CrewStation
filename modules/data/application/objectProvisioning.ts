import type { DataEnv, ServiceId } from '@crewstation/contracts';
import { PLATFORM_ENV } from '@crewstation/contracts';
import { newResourceId, notFound } from '@crewstation/kernel';
import type { ObjectCatalogRepository } from '../ports/objectStorage';
import type { ServiceResolver } from '../ports/platform';

export function objectProvisioning(catalog: ObjectCatalogRepository, services: ServiceResolver, settings: { deploymentMode: 'local' | 'production'; apiUrl: string }) {
  return async (serviceId: ServiceId, env: DataEnv, planId: string): Promise<Record<string, string>> => {
    const service = await services.resolveServiceById(serviceId);
    if (!service) throw notFound('服务');
    const space = await catalog.ensureSpace({ serviceId, projectId: service.projectId, env, fenced: false, id: newResourceId(), planId, deploymentMode: settings.deploymentMode });
    return { [PLATFORM_ENV.objectSpaceId]: space.id, [PLATFORM_ENV.objectsUrl]: `${settings.apiUrl.replace(/\/$/, '')}/v3/objects` };
  };
}
