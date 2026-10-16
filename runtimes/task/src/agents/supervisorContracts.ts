import type { BotContextStorage, BotMessageReceipt, RunnerEvent, StartAgentCommand } from '@crewstation/contracts';
import type { Logger } from '@crewstation/kernel';
import type { BeforeStartRunner } from '../beforeStart/beforeStartRunner';
import type { WorkdirPaths } from '../files/workdirPath';
import type { ProcessLauncher } from '../process/launcher';
import type { AgentDriverFactory } from './driver';

export interface AgentSupervisor {
  botContextInfo?(): { version: 1; conversationId: string; epoch: number; volumeUid: string };
  botReceipt?(requestId: string): BotMessageReceipt | undefined;
  sendBot?(agentId: string, content: string, requestId: string): Promise<BotMessageReceipt>;
  start(command: StartAgentCommand): Promise<void>;
  send(agentId: string, content: string): Promise<void>;
  cancel(agentId: string): Promise<void>;
  cancelAll(): Promise<void>;
  readonly size: number;
}

export interface AgentSupervisorDeps {
  botContext?: BotContextStorage;
  botRoots?: { native: string; receipts: string; scratch: string };
  drivers: AgentDriverFactory;
  launcher: ProcessLauncher;
  paths: WorkdirPaths;
  /** 启动前 Hook 执行器：RFC-006 起每次启动都先经它（步骤可以为空），再创建 CLI 进程。 */
  beforeStart: BeforeStartRunner;
  emit: (event: RunnerEvent) => void;
  logger: Logger;
}

