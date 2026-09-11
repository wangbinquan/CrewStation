import type { Clock, Logger } from '@crewstation/kernel';
import type { CommandForwarder, SessionSettings } from '../ports/forwarding';
import type { ConnectionRegistry, RunnerEventStore } from '../ports/repositories';
import type { RunnerAuth, TaskAccess } from '../ports/taskRuntime';

export interface SessionUseCaseDeps {
  events: RunnerEventStore;
  registry: ConnectionRegistry;
  forwarder: CommandForwarder;
  runnerAuth: RunnerAuth;
  taskAccess: TaskAccess;
  settings: SessionSettings;
  clock: Clock;
  logger: Logger;
}
