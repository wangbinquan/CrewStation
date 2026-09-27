import type { BusinessHandoffBinding, GatewayHandoffBinding, ReleaseHandoffBinding } from '../ports/executionHandoff';
import type { ReleaseId, ServiceId } from '@crewstation/contracts';

/** Late binding breaks the composition cycle; each module retains its own transactions. */
export function executionHandoffPorts(business: () => BusinessHandoffBinding, gateway: () => GatewayHandoffBinding, release: () => ReleaseHandoffBinding) {
  const authority = () => business().releaseHandoff;
  return {
    migrationBarrier: (...args: Parameters<BusinessHandoffBinding['releaseHandoff']['migrationBarrier']>) => authority().migrationBarrier(...args),
    precheck: (...args: Parameters<BusinessHandoffBinding['releaseHandoff']['precheck']>) => authority().precheck(...args),
    freeze: (...args: Parameters<BusinessHandoffBinding['releaseHandoff']['freeze']>) => authority().freeze(...args),
    inspect: (...args: Parameters<BusinessHandoffBinding['releaseHandoff']['inspect']>) => authority().inspect(...args),
    routeObserved: (...args: Parameters<BusinessHandoffBinding['releaseHandoff']['routeObserved']>) => authority().routeObserved(...args),
    observeRoute: async (serviceId: ServiceId, targetReleaseId: ReleaseId, targetSlot: 'blue' | 'green') => {
      const endpoint = await release().activeEndpoint(serviceId);
      return endpoint?.releaseId === targetReleaseId && endpoint.physical === targetSlot && await gateway().productionRouteObserved(serviceId, targetSlot);
    },
  };
}
