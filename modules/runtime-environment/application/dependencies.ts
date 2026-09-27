import type { RuntimeImageExecutionHistory } from '../ports/executionHistory';
import type { UserId } from '@crewstation/contracts';
import type { Clock, Logger } from '@crewstation/kernel';
import type { RuntimeInitializationSecrets, RuntimeImageAuthorizer, RuntimeImageLimits, RuntimeImageSourceResolver, RuntimeImageValidationContracts } from '../ports/platform';
import type { UnitOfWork } from '../ports/unitOfWork';
import type { RuntimeImageReferenceOwners } from '../ports/referenceOwners';

export interface RuntimeImageDeps {
  readonly executionHistory?: RuntimeImageExecutionHistory;
  readonly referenceOwners?: RuntimeImageReferenceOwners;
  isAdmin(id: UserId): Promise<boolean>;
  readonly validationContracts: RuntimeImageValidationContracts;
  readonly initializationSecrets?: RuntimeInitializationSecrets;
  readonly uow: UnitOfWork;
  readonly authorizer: RuntimeImageAuthorizer;
  readonly sources: RuntimeImageSourceResolver;
  readonly limits: RuntimeImageLimits;
  readonly clock: Clock;
  readonly logger: Logger;
}
