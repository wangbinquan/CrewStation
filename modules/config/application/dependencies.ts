import type { Clock } from '@crewstation/kernel';
import type { ProjectAuthorizer } from '../ports/projectAuthorizer';
import type { SecretCipher } from '../ports/secretCipher';
import type { UnitOfWork } from '../ports/unitOfWork';

export interface ConfigUseCaseDeps {
  uow: UnitOfWork;
  cipher: SecretCipher;
  authorizer: ProjectAuthorizer;
  clock: Clock;
}
