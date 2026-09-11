import type { Clock, Logger } from '@crewstation/kernel';
import type { AlertRepository, AlertSubscriptionRepository } from '../ports/repositories';
import type { ClusterObserver, Notifier, ProjectAuthorizer, ServiceResolver, SlotRoles, TraceSources } from '../ports/sources';

export interface ObservabilityUseCaseDeps {
  alerts: AlertRepository;
  subscriptions: AlertSubscriptionRepository;
  cluster: ClusterObserver;
  authorizer: ProjectAuthorizer;
  services: ServiceResolver;
  slots: SlotRoles;
  traces: TraceSources;
  notifier: Notifier;
  clock: Clock;
  logger: Logger;
}
