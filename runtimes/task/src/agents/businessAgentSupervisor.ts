import type { AgentEvent } from '@crewstation/contracts';
import type { Logger } from '@crewstation/kernel';
import { RunnerCommandError } from '../commandError';
import type { ExecutionIdentity, ExecutionJournal, ExecutionReceipt, ExecutionResult } from '../exec/executionJournal';
import type { AgentProcess } from './driver';

interface ActiveAgent {
  agent?: AgentProcess; done?: Promise<void>; cancellation?: Promise<void>; cancelRequested: boolean;
  startedAt: number; failure?: ExecutionResult['reason'];
}

/** A durable receipt precedes CLI construction. Repeated starts and old incarnations never construct a second Agent. */
export class BusinessAgentSupervisor {
  private readonly active = new Map<string, ActiveAgent>();
  constructor(private readonly journal: ExecutionJournal, private readonly logger: Logger) {}

  start(identity: ExecutionIdentity, create: () => Promise<AgentProcess>): ExecutionReceipt {
    const reserved = this.journal.reserve(identity);
    if (!reserved.created) return reserved.receipt;
    const entry: ActiveAgent = { cancelRequested: false, startedAt: Date.now() };
    this.active.set(identity.executionId, entry);
    entry.done = this.run(identity.executionId, entry, create).catch(() => {
      // A storage error cannot become a false successful result or permit another process.
      try { this.journal.unknown(identity.executionId); } catch { /* Storage failure remains unavailable. */ }
      this.logger.error('business agent result unavailable', { executionId: identity.executionId });
    }).finally(() => { this.active.delete(identity.executionId); });
    return this.receipt(identity.executionId);
  }

  send(id: string, content: string): Promise<void> {
    const agent = this.active.get(id)?.agent;
    if (!agent) throw new RunnerCommandError('agent_not_running', '当前 Runner 没有该 Agent 进程');
    return agent.send(content);
  }
  owns(id: string): boolean { return this.active.has(id); }
  cancel(id: string): ExecutionReceipt {
    const receipt = this.receipt(id);
    if (receipt.phase === 'finished') return receipt;
    const entry = this.active.get(id);
    if (!entry) throw new RunnerCommandError('execution_unknown', '当前 Runner 无法证明原 Agent 已停止');
    entry.cancelRequested = true;
    this.journal.state(id, 'cancelling');
    if (entry.agent) this.requestStop(entry);
    return this.receipt(id);
  }
  async settled(id: string): Promise<ExecutionReceipt> { await this.active.get(id)?.done; return this.receipt(id); }
  async drain(): Promise<void> {
    for (const id of this.active.keys()) this.cancel(id);
    await Promise.allSettled([...this.active.values()].map((entry) => entry.done));
  }
  private requestStop(entry: ActiveAgent): void {
    entry.cancellation ??= entry.agent!.cancel().catch(() => { this.logger.warn('business agent stop unconfirmed'); });
  }
  private receipt(id: string): ExecutionReceipt {
    const receipt = this.journal.get(id);
    if (!receipt) throw new RunnerCommandError('execution_not_found', '执行记录不存在');
    return receipt;
  }
  private async run(id: string, entry: ActiveAgent, create: () => Promise<AgentProcess>): Promise<void> {
    let exitCode: number | null = null, ended = false;
    try {
      entry.agent = await create();
    } catch {
      this.journal.finish(id, { reason: entry.cancelRequested ? 'cancelled' : 'spawn_failed', exitCode, durationMs: Date.now() - entry.startedAt }); return;
    }
    try {
      if (entry.cancelRequested) this.requestStop(entry); else this.journal.state(id, 'running');
      for await (const input of entry.agent.events) {
        if (input.type === 'completed' || input.type === 'cancelled' || input.type === 'error') {
          ended = true; exitCode = input.result?.exitCode ?? null;
          if (input.type === 'error') entry.failure ??= 'agent_failed';
          if (input.type === 'cancelled') entry.cancelRequested = true;
        }
        if (entry.failure === 'output_limit' || entry.failure === 'event_persistence_failed') continue;
        try { this.journal.agent(id, publicEvent(input)); }
        catch (error) {
          entry.failure = error instanceof RunnerCommandError && error.code === 'output_limit' ? 'output_limit' : 'event_persistence_failed';
          this.requestStop(entry);
        }
      }
    } catch {
      this.requestStop(entry);
      // An exception from an event iterator is not proof that its OS process exited.
      await entry.cancellation; throw new RunnerCommandError('execution_unknown', 'Agent 事件流异常结束，停止尚需确认');
    }
    // Driver streams close only after process exit/drain or a proven pre-start failure.
    if (!ended) throw new RunnerCommandError('execution_unknown', 'Agent 未提供结束证明');
    this.journal.finish(id, { reason: entry.failure ?? (entry.cancelRequested ? 'cancelled' : 'exited'), exitCode, durationMs: Date.now() - entry.startedAt });
  }
}
function publicEvent(input: AgentEvent): Omit<AgentEvent, 'raw'> {
  const { raw: _raw, ...event } = input;
  return event;
}
