import type { RunnerEvent, StartAgentCommand } from '@crewstation/contracts';
import type { Logger } from '@crewstation/kernel';
import { RunnerCommandError, alreadyExists, notFound } from '../commandError';
import type { WorkdirPaths } from '../files/workdirPath';
import type { ProcessLauncher } from '../process/launcher';
import type { AgentProcess, AgentSpec } from './driver';
import type { DriverRegistry } from './registry';

export interface AgentSupervisor {
  start(command: StartAgentCommand): Promise<void>;
  send(agentId: string, content: string): Promise<void>;
  cancel(agentId: string): Promise<void>;
  cancelAll(): Promise<void>;
  readonly size: number;
}

export interface AgentSupervisorDeps {
  registry: DriverRegistry;
  launcher: ProcessLauncher;
  paths: WorkdirPaths;
  /** 来自 CS_AGENT_ENV_FILE 的模型凭据；只进 Agent 进程。 */
  agentEnv: Record<string, string>;
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
      const driver = deps.registry.get(command.driver);
      if (!driver) throw new RunnerCommandError('driver_unknown', `未知驱动 ${command.driver}`);
      const cwd = await deps.paths.resolveCwd(command.cwd);
      const env = deps.launcher.baseEnv({ ...deps.agentEnv, ...command.env });
      const logger = deps.logger.child({ agentId: command.agentId, driver: command.driver });
      const agent = driver.start(toSpec(command), { cwd, env, launcher: deps.launcher, logger });
      running.set(command.agentId, agent);
      logger.info('agent started', { mode: command.mode, model: command.model, mcp: command.mcp.length, envKeys: Object.keys(command.env).length });
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
    driver: command.driver,
    model: command.model,
    permission: command.permission,
    mode: command.mode,
    initialPrompt: command.initialPrompt,
    resumeSessionId: command.resumeSessionId,
    systemPrompt: command.systemPrompt,
    mcp: command.mcp,
  };
}
