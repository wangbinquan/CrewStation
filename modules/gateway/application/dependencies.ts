import type { Clock, Logger } from '@crewstation/kernel';
import type { GrantSource, HostNaming, ServiceDirectory, SlotRoles } from '../ports/directories';
import type { GatewayApplier, GatewaySettings } from '../ports/gatewayApply';
import type { AllowlistRepository, PodIdentityRepository, RouteRepository } from '../ports/repositories';

export interface GatewayUseCaseDeps {
  allowlists: AllowlistRepository;
  pods: PodIdentityRepository;
  routes: RouteRepository;
  applier: GatewayApplier;
  services: ServiceDirectory;
  slots: SlotRoles;
  grants: GrantSource;
  hosts: HostNaming;
  settings: GatewaySettings;
  clock: Clock;
  logger: Logger;
}
