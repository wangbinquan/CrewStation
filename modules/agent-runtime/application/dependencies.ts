import type { Clock, Logger } from '@crewstation/kernel';
import type { CheckExecutor } from '../ports/checkExecutor';
import type { ProfileReferences } from '../ports/profileReferences';
import type { SecretCipher } from '../ports/secretCipher';
import type { UnitOfWork } from '../ports/unitOfWork';

export interface AgentRuntimeUseCaseDeps {
  uow: UnitOfWork;
  cipher: SecretCipher;
  executor: CheckExecutor;
  references: ProfileReferences;
  clock: Clock;
  logger: Logger;
}
