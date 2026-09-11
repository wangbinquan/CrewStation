import type { Clock, Logger } from '@crewstation/kernel';
import type { DataSettings, ProjectAuthorizer, ServiceResolver } from '../ports/platform';
import type { PostgresProvider, SecretCipher } from '../ports/providers';
import type { DataResourceRepository, TaskDataBindingRepository } from '../ports/repositories';

export interface DataUseCaseDeps {
  resources: DataResourceRepository;
  bindings: TaskDataBindingRepository;
  postgres: PostgresProvider;
  cipher: SecretCipher;
  authorizer: ProjectAuthorizer;
  services: ServiceResolver;
  settings: DataSettings;
  clock: Clock;
  logger: Logger;
}
