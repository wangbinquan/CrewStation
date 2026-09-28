import type { ServiceId } from '@crewstation/contracts';
import type { ExecutionAgentSecrets } from '../../ports/executionAgentSecrets';
import type { ExecutionSessions } from '../../ports/executionSessions';
import type { ExecutionMessages } from '../../ports/executionMessages';
import type { ExecutionMaterials } from '../../ports/executionMaterials';
import type { ExecutionLifecycles } from '../../ports/executionLifecycle';
import type { BusinessRuntimeImages } from '../../ports/runtimeImages';
import type { ExecutionCancellations } from '../../ports/executionCancellations';
import type { ExecutionProjection } from '../../ports/executionProjection';
import type { ExecutionObservationAdmission, ExecutionSubtasks } from '../../ports/executionSubtasks';
import type { ExecutionPayloadCipher } from '../../domain/executionSubtask';
import type { BusinessTaskUseCaseDeps } from '../dependencies';
import type { ExecutionOperations } from '../../ports/executionOperations';
import type { ExecutionControls } from '../../ports/executionControl';
import type { BusinessExecutionSourceResolver } from '../../ports/executionSource';
import type { TaskRecoveryRequests } from '../../ports/taskRecovery';
import type { TaskInputPreparation } from '../../ports/storage/taskInputs';

export interface BusinessExecutionDeps extends Pick<BusinessTaskUseCaseDeps, 'uow' | 'environments' | 'directory' | 'clock' | 'logger' | 'runner' | 'compute' | 'settings'> {
  taskInputs?: TaskInputPreparation;
  storageStatus?: (serviceId: ServiceId) => Promise<{ available: boolean; reason: string | null }>;
  executionObservations?: ExecutionObservationAdmission;
  recoveryRequests?: TaskRecoveryRequests;
  agentSecrets?: ExecutionAgentSecrets;
  sessions: ExecutionSessions;
  messages: ExecutionMessages;
  materials: ExecutionMaterials;
  lifecycles: ExecutionLifecycles;
  runtimeImages?: BusinessRuntimeImages;
  cancellations: ExecutionCancellations;
  projection: ExecutionProjection;
  subtasks: ExecutionSubtasks;
  cipher: ExecutionPayloadCipher;
  sources: BusinessExecutionSourceResolver;
  operations: ExecutionOperations;
  controls: ExecutionControls;
}
