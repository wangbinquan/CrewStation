import type { Clock, Logger } from '@crewstation/kernel';
import type { AlertRepository } from '../ports/repositories';
import type { ClusterObserver, ProjectAuthorizer, ServiceResolver, SlotRoles, TraceSources } from '../ports/sources';

export interface ObservabilityUseCaseDeps {
  alerts: AlertRepository;
  cluster: ClusterObserver;
  authorizer: ProjectAuthorizer;
  services: ServiceResolver;
  slots: SlotRoles;
  traces: TraceSources;
  clock: Clock;
  logger: Logger;
}
