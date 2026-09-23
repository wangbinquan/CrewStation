import type { Clock, Logger } from '@crewstation/kernel';
import type { AlertRepository } from '../ports/repositories';
import type { ClusterObserver, ProjectAuthorizer, ServiceResolver, SlotRecords, SlotRoles } from '../ports/sources';

export interface ObservabilityUseCaseDeps {
  alerts: AlertRepository;
  cluster: ClusterObserver;
  authorizer: ProjectAuthorizer;
  services: ServiceResolver;
  slots: SlotRoles;
  /** 服务槽记录（RFC-025）；缺省时健康与巡检按请求读集群。 */
  records?: SlotRecords;
  clock: Clock;
  logger: Logger;
}
