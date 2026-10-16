import type { AgentSupervisor, AgentSupervisorDeps } from './supervisorContracts';
export type { AgentSupervisor, AgentSupervisorDeps } from './supervisorContracts';
import type { StartAgentCommand } from '@crewstation/contracts';
import { isKnownProtocol } from '@crewstation/contracts';
import { RunnerCommandError, alreadyExists, notFound } from '../commandError';
import type { AgentProcess, AgentSpec } from './driver';
import { createAgentEventFactory } from './driver';
import { ManagedAgentProcess } from './managedAgent';
import { withBotContext } from '../bot/supervisor';

/** 多个 Agent 并行运行（开发会话的多个流式交互 Agent）；每个 Agent 的事件流独立泵入 RunnerEvent。 */
export function createAgentSupervisor(deps: AgentSupervisorDeps): AgentSupervisor { return withBotContext(new PendingAgentSupervisor(deps), deps); }

interface PendingAgent { cancelled: boolean; process?: AgentProcess }
class PendingAgentSupervisor implements AgentSupervisor {
  private readonly running = new Map<string, AgentProcess>();
  private readonly entries = new Map<string, PendingAgent>();
  private readonly pumps = new Set<Promise<void>>();
  constructor(private readonly deps: AgentSupervisorDeps) {}

  async start(command: StartAgentCommand): Promise<void> {
    const { protocol } = command.launch, deps = this.deps;
    // 协议层（StartAgentCommandSchema）已拒绝；这里再判一次：通用终端协议没有 headless 驱动。
    if (!isKnownProtocol(protocol)) throw new RunnerCommandError('protocol_unsupported', '通用终端协议的档位只能用于「＋ CLI」');
    if (this.entries.has(command.agentId)) throw alreadyExists('agent_exists', 'agent ' + command.agentId);
    const entry: PendingAgent = { cancelled: false };
    // Register before the first await, so a pending CWD can be cancelled.
    this.entries.set(command.agentId, entry);
    try {
      const driver = deps.drivers.forProtocol(protocol), cwd = await deps.paths.resolveCwd(command.cwd);
      if (entry.cancelled) {
        deps.emit({ kind: 'agent', event: createAgentEventFactory(command.agentId)('cancelled', { result: { durationMs: 0 } }) });
        return;
      }
      const logger = deps.logger.child({ agentId: command.agentId, protocol });
      // Hook 成功后才创建 CLI 进程；凭据只来自档位的启动前材料与命令追加的变量（RFC-006 删除了部署配置的凭据文件）。
      const agent = new ManagedAgentProcess(toSpec(command), { driver, beforeStart: deps.beforeStart, launcher: deps.launcher, cwd, commandEnv: command.env, material: command.beforeStart, processAttemptId: command.processAttemptId, logger, ...(command.botContext && deps.botContext ? { botContext: deps.botContext, botRoots: deps.botRoots } : {}) });
      entry.process = agent; this.running.set(command.agentId, agent);
      logger.info('agent started', { mode: command.mode, profile: command.compute + '@' + command.profileRevision, model: command.launch.model ?? null, mcp: command.mcp.length, envKeys: Object.keys(command.env).length, steps: command.beforeStart.steps.length });
      const pumping = pumpAgent(deps, this.running, command.agentId, agent);
      this.pumps.add(pumping);
      const settled = () => {
        this.pumps.delete(pumping);
        if (this.entries.get(command.agentId) === entry) this.entries.delete(command.agentId);
      };
      void pumping.then(settled, settled);
    } finally { if (!entry.process && this.entries.get(command.agentId) === entry) this.entries.delete(command.agentId); }
  }

  send(agentId: string, content: string): Promise<void> { return this.lookup(agentId).send(content); }
  async cancel(agentId: string): Promise<void> {
    const entry = this.entries.get(agentId);
    if (!entry) { await this.lookup(agentId).cancel(); return; }
    entry.cancelled = true;
    if (entry.process) await entry.process.cancel();
  }
  async cancelAll(): Promise<void> {
    await Promise.allSettled([...this.entries.keys()].map((agentId) => this.cancel(agentId)));
    await Promise.allSettled([...this.pumps]);
  }
  get size(): number { return new Set([...this.running.keys(), ...[...this.entries].filter(([, e]) => !e.process).map(([id]) => id)]).size; }
  private lookup(agentId: string): AgentProcess {
    const agent = this.running.get(agentId);
    if (!agent) throw notFound('agent ' + agentId);
    return agent;
  }
}

function toSpec(command: StartAgentCommand): AgentSpec {
  return {
    strictSession: command.botContext !== undefined,
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

async function pumpAgent(deps: AgentSupervisorDeps, running: Map<string, AgentProcess>, agentId: string, agent: AgentProcess): Promise<void> {
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
}
