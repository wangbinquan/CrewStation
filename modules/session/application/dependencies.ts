import type { AgentCallSink } from '../ports/agentCallSink';
import type { LegacyRunnerBoundary } from '../ports/legacyRunner';
import type { Clock, Logger } from '@crewstation/kernel';
import type { CommandForwarder, SessionSettings } from '../ports/forwarding';
import type { ConnectionRegistry, RunnerEventStore } from '../ports/repositories';
import type { RunnerAuth, TaskAccess } from '../ports/taskRuntime';
import type { BusinessExecutionStore } from '../ports/businessExecutions';
import type { SessionConnectionHistory } from '../ports/projectDeletion';
import type { SessionProjectWork } from '../ports/projectWork';

export interface SessionUseCaseDeps {
  connectionHistory?: SessionConnectionHistory;
  projectWork?: SessionProjectWork;
  /** RFC-034 v2：Agent 用量快照与终态交给 observability（组合根装配）；缺省不转交。 */
  agentCalls?: AgentCallSink;
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
