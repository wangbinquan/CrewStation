import type { RunnerEvent, StartAgentCommand } from '@crewstation/contracts';
import { isKnownProtocol } from '@crewstation/contracts';
import type { Logger } from '@crewstation/kernel';
import type { BeforeStartRunner } from '../beforeStart/beforeStartRunner';
import { RunnerCommandError, alreadyExists, notFound } from '../commandError';
import type { WorkdirPaths } from '../files/workdirPath';
import type { ProcessLauncher } from '../process/launcher';
import type { AgentDriverFactory, AgentProcess, AgentSpec } from './driver';
import { ManagedAgentProcess } from './managedAgent';

export interface AgentSupervisor {
  start(command: StartAgentCommand): Promise<void>;
  send(agentId: string, content: string): Promise<void>;
  cancel(agentId: string): Promise<void>;
  cancelAll(): Promise<void>;
  readonly size: number;
}

export interface AgentSupervisorDeps {
  drivers: AgentDriverFactory;
  launcher: ProcessLauncher;
  paths: WorkdirPaths;
  /** 启动前 Hook 执行器：RFC-006 起每次启动都先经它（步骤可以为空），再创建 CLI 进程。 */
  beforeStart: BeforeStartRunner;
  emit: (event: RunnerEvent) => void;
  logger: Logger;
}

/** 多个 Agent 并行运行（开发会话的多个流式交互 Agent）；每个 Agent 的事件流独立泵入 RunnerEvent。 */
export function createAgentSupervisor(deps: AgentSupervisorDeps): AgentSupervisor {
  const running = new Map<string, AgentProcess>();
  const pump = async (agentId: string, agent: AgentProcess): Promise<void> => {
    try {
      for await (const event of agent.events) deps.emit({ kind: 'agent', event });
    } catch (error) {
      deps.logger.error('agent event stream failed', { agentId, error: error instanceof Error ? error.message : String(error) });
      deps.emit({ kind: 'agent', event: { agentId, seq: 0, at: new Date().toISOString(), type: 'error', error: { code: 'driver_failed', message: '驱动事件流异常终止' } } });
    } finally {
      if (running.get(agentId) === agent) running.delete(agentId);
      deps.beforeStart.release(agentId);
      deps.logger.info('agent finished', { agentId });
    }
  };
  const lookup = (agentId: string): AgentProcess => {
    const agent = running.get(agentId);
    if (!agent) throw notFound(`agent ${agentId}`);
    return agent;
  };
  return {
    async start(command) {
      if (running.has(command.agentId)) throw alreadyExists('agent_exists', `agent ${command.agentId}`);
      const { protocol } = command.launch;
      // 协议层（StartAgentCommandSchema）已拒绝；这里再判一次：通用终端协议没有 headless 驱动。
      if (!isKnownProtocol(protocol)) throw new RunnerCommandError('protocol_unsupported', '通用终端协议的档位只能用于「＋ CLI」');
      const driver = deps.drivers.forProtocol(protocol);
      const cwd = await deps.paths.resolveCwd(command.cwd);
      const logger = deps.logger.child({ agentId: command.agentId, protocol });
      // Hook 成功后才创建 CLI 进程；凭据只来自档位的启动前材料与命令追加的变量（RFC-006 删除了部署配置的凭据文件）。
      const agent = new ManagedAgentProcess(toSpec(command), { driver, beforeStart: deps.beforeStart, launcher: deps.launcher, cwd, commandEnv: command.env, material: command.beforeStart, processAttemptId: command.processAttemptId, logger });
      running.set(command.agentId, agent);
      logger.info('agent started', { mode: command.mode, profile: `${command.compute}@${command.profileRevision}`, model: command.launch.model ?? null, mcp: command.mcp.length, envKeys: Object.keys(command.env).length, steps: command.beforeStart.steps.length });
      void pump(command.agentId, agent);
    },
    send: (agentId, content) => lookup(agentId).send(content),
    cancel: (agentId) => lookup(agentId).cancel(),
    async cancelAll() {
      await Promise.allSettled([...running.values()].map((agent) => agent.cancel()));
    },
    get size() {
      return running.size;
    },
  };
}

function toSpec(command: StartAgentCommand): AgentSpec {
  return {
    agentId: command.agentId,
    compute: command.compute,
    profileRevision: command.profileRevision,
    launch: command.launch,
    permission: command.permission,
    mode: command.mode,
    ...(command.initialPrompt === undefined ? {} : { initialPrompt: command.initialPrompt }),
    ...(command.resumeSessionId === undefined ? {} : { resumeSessionId: command.resumeSessionId }),
    ...(command.systemPrompt === undefined ? {} : { systemPrompt: command.systemPrompt }),
    mcp: command.mcp,
  };
}
