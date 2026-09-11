import type { Clock } from '@crewstation/kernel';
import type { EventPusher } from '../ports/eventPusher';
import type { EventsSettings } from '../ports/eventsSettings';
import type { HandlerEndpointResolver } from '../ports/handlerEndpointResolver';
import type { ProjectAuthorizer } from '../ports/projectAuthorizer';
import type { ServiceResolver } from '../ports/serviceResolver';
import type { UnitOfWork } from '../ports/unitOfWork';

export interface EventsUseCaseDeps {
  uow: UnitOfWork;
  services: ServiceResolver;
  projects: ProjectAuthorizer;
  endpoints: HandlerEndpointResolver;
  pusher: EventPusher;
  settings: EventsSettings;
  clock: Clock;
}
