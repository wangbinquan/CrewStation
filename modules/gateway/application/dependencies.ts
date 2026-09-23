import type { Clock, Logger } from '@crewstation/kernel';
import type { GrantSource, HostNaming, ProjectAccess, ServiceDirectory, SlotRoles, UserDirectory } from '../ports/directories';
import type { GatewayApplier, GatewaySettings } from '../ports/gatewayApply';
import type { AllowlistRepository, MaintenanceUnitOfWork, PodIdentityRepository, RouteRepository } from '../ports/repositories';

export interface GatewayUseCaseDeps {
  normalizeTaskId?: (value: string) => Promise<string | undefined>;
  allowlists: AllowlistRepository;
  pods: PodIdentityRepository;
  routes: RouteRepository;
  /** RFC-021：正式版本维护的状态、记录与领域事件。 */
  maintenanceUow: MaintenanceUnitOfWork;
  access: ProjectAccess;
  users: UserDirectory;
  applier: GatewayApplier;
  services: ServiceDirectory;
  slots: SlotRoles;
  grants: GrantSource;
  hosts: HostNaming;
  settings: GatewaySettings;
  clock: Clock;
  logger: Logger;
}
