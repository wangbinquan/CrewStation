import type { DevelopmentUsageRegistration, DevelopmentUsageDrainReason, RunnerCommand, RunnerHello, StartAgentCommand, StoredDevelopmentUsage, TaskId } from '@crewstation/contracts';
import type { DevelopmentUsageOwner, DevelopmentUsageOwnerRecord } from './developmentUsage';
import type { DevelopmentDispatchDecision } from '../domain/developmentDispatch';
export type { DevelopmentDispatchDecision, DevelopmentDispatchWaiting } from '../domain/developmentDispatch';

/** Independent Session port. Transport failure never permits a legacy start. */
export interface DevelopmentDispatchSession {
  connectionStatus(taskId: TaskId): Promise<{ connected: boolean; capabilities?: RunnerHello['capabilities'] }>;
  registerDevelopmentUsage(registration: DevelopmentUsageRegistration): Promise<StoredDevelopmentUsage>;
  sendCommand(taskId: TaskId, command: RunnerCommand): Promise<unknown>;
}
export type DevelopmentDispatchResult = Exclude<DevelopmentDispatchDecision, { kind: 'empty' }>
  | { kind: 'legacy'; reason: 'unselected' | 'unsupported' }
  | { kind: 'ending'; reason: DevelopmentUsageDrainReason };
export interface DevelopmentDispatchDeps {
  owner: Pick<DevelopmentUsageOwner, 'get' | 'bind' | 'observeSupported' | 'unsupported'>;
  session: DevelopmentDispatchSession;
  /** Called only after the original healthy journal proves no acceptance. */
  material(original: DevelopmentUsageOwnerRecord): Promise<StartAgentCommand>;
}
