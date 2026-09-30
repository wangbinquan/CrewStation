import type { DevelopmentUsageAdmission, DevelopmentUsageStopReceipt, RunnerEvent, StartAgentCommand } from '@crewstation/contracts';
import { isKnownProtocol } from '@crewstation/contracts';
import type { Logger } from '@crewstation/kernel';
import type { BeforeStartRunner } from '../beforeStart/beforeStartRunner';
import { RunnerCommandError, alreadyExists, notFound } from '../commandError';
import type { WorkdirPaths } from '../files/workdirPath';
import type { ProcessLauncher } from '../process/launcher';
import type { AgentDriverFactory, AgentProcess, AgentSpec } from './driver';
import { createAgentEventFactory } from './driver';
import { ManagedAgentProcess } from './managedAgent';
import { reserveDevelopmentUsage, type DevelopmentAgentUsage } from './developmentAgentUsage';
import type { DevelopmentUsageJournal } from './developmentUsageJournal';

export interface AgentSupervisor {
  start(command: StartAgentCommand): Promise<void>;
  send(agentId: string, content: string): Promise<void>;
  cancel(agentId: string): Promise<void>;
  cancelAll(): Promise<void>;
  stopDevelopmentAgent?(admission: DevelopmentUsageAdmission, podUid: string): Promise<DevelopmentUsageStopReceipt>;
  readonly size: number;
}

export interface AgentSupervisorDeps {
  developmentUsage?: DevelopmentUsageJournal;
  drivers: AgentDriverFactory;
  launcher: ProcessLauncher;
  paths: WorkdirPaths;
  /** 启动前 Hook 执行器：RFC-006 起每次启动都先经它（步骤可以为空），再创建 CLI 进程。 */
  beforeStart: BeforeStartRunner;
  emit: (event: RunnerEvent) => void;
  logger: Logger;
}

/** 多个 Agent 并行运行（开发会话的多个流式交互 Agent）；每个 Agent 的事件流独立泵入 RunnerEvent。 */
export function createAgentSupervisor(deps: AgentSupervisorDeps): AgentSupervisor { return new PendingAgentSupervisor(deps); }

interface PendingAgent { cancelled: boolean; usage?: DevelopmentAgentUsage; process?: AgentProcess }
class PendingAgentSupervisor implements AgentSupervisor {
  private readonly running = new Map<string, AgentProcess>();
  private readonly entries = new Map<string, PendingAgent>();
  private readonly pumps = new Set<Promise<void>>();
  constructor(private readonly deps: AgentSupervisorDeps) {}

  async start(command: StartAgentCommand): Promise<void> {
    const { protocol } = command.launch, deps = this.deps;
    if (!isKnownProtocol(protocol)) throw new RunnerCommandError('protocol_unsupported', '通用终端协议的档位只能用于「＋ CLI」');
    const usage = reserveDevelopmentUsage(command, deps.developmentUsage);
    if (usage?.replayed) return;
    if (this.entries.has(command.agentId)) throw alreadyExists('agent_exists', 'agent ' + command.agentId);
    const entry: PendingAgent = { cancelled: false, usage };
    // Register before the first await, so a pending CWD can be cancelled.
    this.entries.set(command.agentId, entry);
    try {
      const driver = deps.drivers.forProtocol(protocol), cwd = await deps.paths.resolveCwd(command.cwd);
      if (entry.cancelled) {
        const event = createAgentEventFactory(command.agentId)('cancelled', { result: { durationMs: 0 } });
        usage?.observe(event); deps.emit({ kind: 'agent', event }); return;
      }
      const logger = deps.logger.child({ agentId: command.agentId, protocol });
      const agent = new ManagedAgentProcess(toSpec(command), { driver, beforeStart: deps.beforeStart, launcher: deps.launcher, cwd, commandEnv: command.env, material: command.beforeStart, processAttemptId: command.processAttemptId,
        usageSink: usage?.capture, usageInterrupted: usage?.incomplete, usageCanLaunch: usage?.permitLaunch, logger });
      entry.process = agent; this.running.set(command.agentId, agent);
      logger.info('agent started', { mode: command.mode, profile: command.compute + '@' + command.profileRevision, model: command.launch.model ?? null, mcp: command.mcp.length, envKeys: Object.keys(command.env).length, steps: command.beforeStart.steps.length });
      const pumping = pumpAgent(deps, this.running, command.agentId, agent, usage);
      this.pumps.add(pumping);
      const settled = () => {
        this.pumps.delete(pumping);
        // A failed numeric stream may leave an unproven child alive; retain its cancellation handle.
        if (!usage?.unprovenExit() && this.entries.get(command.agentId) === entry) this.entries.delete(command.agentId);
      };
      void pumping.then(settled, settled);
    } catch (error) { usage?.finish(entry.cancelled ? 'cancelled' : 'error'); throw error; }
    finally { if (!entry.process && this.entries.get(command.agentId) === entry) this.entries.delete(command.agentId); }
  }

  send(agentId: string, content: string): Promise<void> { return this.lookup(agentId).send(content); }
  async cancel(agentId: string): Promise<void> {
    const entry = this.entries.get(agentId);
    if (!entry) { await this.lookup(agentId).cancel(); return; }
    entry.usage?.stop(); entry.cancelled = true;
    if (entry.process) await entry.process.cancel();
  }
  async stopDevelopmentAgent(admission: DevelopmentUsageAdmission, podUid: string): Promise<DevelopmentUsageStopReceipt> {
    const journal = this.deps.developmentUsage;
    if (!journal) throw new RunnerCommandError('development_usage_unsupported', '当前Runner未提供开发数字日志');
    const entry = this.entries.get(admission.intent.identity.agentId);
    if (entry && (!entry.usage || !entry.usage.matches(admission.key))) throw new RunnerCommandError('development_intent_conflict', '停止不能取消不同执行');
    journal.requestStop(admission, podUid);
    if (entry) { entry.cancelled = true; if (entry.process) await entry.process.cancel(); }
    return journal.stopStatus(admission.key, Boolean(entry));
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
    ...(command.developmentUsage ? { usageObservationsV1: 1 as const, nativeUsageTreeV1: 1 as const, nativeUsageLineageKey: command.developmentUsage.intent.nativeUsageLineageKey, ...(command.developmentUsage.intent.nativeSource?.version === 1 ? { developmentNativeSourceV1: 1 as const } : {}) } : {}),
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

async function pumpAgent(deps: AgentSupervisorDeps, running: Map<string, AgentProcess>, agentId: string, agent: AgentProcess, usage?: DevelopmentAgentUsage): Promise<void> {
  try {
    for await (const event of agent.events) {
      if (!usage || usage.observe(event)) deps.emit({ kind: 'agent', event });
    }
  } catch (error) {
    usage?.incomplete();
    const event = { agentId, seq: 0, at: new Date().toISOString(), type: 'error' as const, error: { code: 'driver_failed', message: '驱动事件流异常终止' } };
    usage?.observe(event);
    deps.logger.error('agent event stream failed', { agentId, error: error instanceof Error ? error.message : String(error) });
    deps.emit({ kind: 'agent', event });
  } finally {
    usage?.incomplete();
    if (running.get(agentId) === agent) running.delete(agentId);
    deps.beforeStart.release(agentId);
    deps.logger.info('agent finished', { agentId });
  }
}
