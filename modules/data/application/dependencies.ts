import type { Clock, Logger } from '@crewstation/kernel';
import type { DataSettings, ProjectAuthorizer, ServiceResolver } from '../ports/platform';
import type { PostgresProvider, SecretCipher } from '../ports/providers';
import type { DataResourceRepository, TaskDataBindingRepository } from '../ports/repositories';
import type { UserDirectory } from '../ports/userDirectory';

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
  /** 可选：申请人／审批人名字；缺省时绑定 DTO 只有 ID。 */
  users?: UserDirectory;
}
