import type { DevelopmentUsageStore } from '../ports/developmentUsage';
import type { LegacyRunnerBoundary } from '../ports/legacyRunner';
import type { Clock, Logger } from '@crewstation/kernel';
import type { CommandForwarder, SessionSettings } from '../ports/forwarding';
import type { ConnectionRegistry, RunnerEventStore } from '../ports/repositories';
import type { RunnerAuth, TaskAccess } from '../ports/taskRuntime';
import type { BusinessExecutionStore } from '../ports/businessExecutions';
import type { SessionConnectionHistory } from '../ports/projectDeletion';

export interface SessionUseCaseDeps {
  connectionHistory?: SessionConnectionHistory;
  developmentUsage?: DevelopmentUsageStore;
  businessExecutions?: BusinessExecutionStore;
  legacyRunners?: LegacyRunnerBoundary;
  events: RunnerEventStore;
  registry: ConnectionRegistry;
  forwarder: CommandForwarder;
  runnerAuth: RunnerAuth;
  taskAccess: TaskAccess;
  settings: SessionSettings;
  clock: Clock;
  logger: Logger;
}
