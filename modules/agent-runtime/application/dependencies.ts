import type { Clock, Logger } from '@crewstation/kernel';
import type { ImageRegistry } from '../ports/imageRegistry';
import type { ProfileReferences } from '../ports/profileReferences';
import type { SecretCipher } from '../ports/secretCipher';
import type { TaskProfileDirectory } from '../ports/taskProfiles';
import type { ProfileTestExecutor } from '../ports/testExecutor';
import type { UnitOfWork } from '../ports/unitOfWork';

export interface AgentRuntimeUseCaseDeps {
  uow: UnitOfWork;
  cipher: SecretCipher;
  executor: ProfileTestExecutor;
  references: ProfileReferences;
  taskProfiles: TaskProfileDirectory;
  registry: ImageRegistry;
  clock: Clock;
  logger: Logger;
}
