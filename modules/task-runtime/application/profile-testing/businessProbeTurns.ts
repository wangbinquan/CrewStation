import { randomBytes } from 'node:crypto';
import type { AgentEvent, RunnerCommand, StartAgentCommand, TaskId } from '@crewstation/contracts';
import { BusinessExecutionEventSchema, BusinessExecutionInfoSchema, StoredBusinessExecutionSchema, businessAgentDigestInput } from '@crewstation/contracts';
import { isPlatformError, newResourceId } from '@crewstation/kernel';
import type { TestRunner } from '../../ports/platform';

export interface BusinessProbeTurnDeps { runner: TestRunner; taskId: TaskId; budgetMs: number; pollMs: number; heartbeat(): Promise<boolean> }
export interface BusinessProbeTurn { ok: boolean; sessionId?: string; events: AgentEvent[]; text: string }
export async function businessProbeTurn(deps: BusinessProbeTurnDeps, agent: StartAgentCommand, expected: string): Promise<BusinessProbeTurn> {
  const info = BusinessExecutionInfoSchema.parse(await deps.runner.sendCommand(deps.taskId, { id: newResourceId(), type: 'businessExecutionInfo' }));
  const digestNonce = randomBytes(32).toString('hex'), executionId = agent.agentId;
  const payloadDigest = new Bun.CryptoHasher('sha256').update(businessAgentDigestInput(agent, digestNonce)).digest('hex');
  const command: RunnerCommand = { id: newResourceId(), type: 'startBusinessAgent', executionId, attempt: 1, incarnation: info.incarnation, payloadDigest, digestNonce, agent };
  try { await deps.runner.sendCommand(deps.taskId, command); }
  catch (error) {
    if (isPlatformError(error) && error.kind !== 'unavailable') throw error;
    // Only an uncertain transport result needs reconciliation of the original identity.
  }
  const result = await observe(deps, executionId);
  return { ...result, ok: result.ok && result.text.trim() === expected };
}
async function observe(deps: BusinessProbeTurnDeps, executionId: string): Promise<BusinessProbeTurn> {
  let after = 0, text = '', sessionId: string | undefined;
  const events: AgentEvent[] = [], deadline = Date.now() + deps.budgetMs;
  try {
    for (;;) {
      if (!await deps.heartbeat()) throw new Error('业务能力测试租约丢失');
      const { stored, page } = await readProbeEvents(deps, executionId, after), receipt = stored.receipt;
      for (const entry of page) {
        if (entry.sequence !== after + 1) throw new Error('业务能力测试事件不连续'); after = entry.sequence;
        if (entry.frame.type !== 'agent') continue;
        const event = entry.frame.event; events.push(event);
        if (event.type === 'text') text += event.text ?? '';
        if (event.type === 'session') sessionId = event.sessionId;
      }
      if (events.length > 2000 || text.length > 262144) throw new Error('业务能力测试输出超限');
      if (receipt.phase === 'unknown') throw new Error('业务能力测试执行结果未知');
      if (stored.complete && receipt.phase === 'finished' && after >= receipt.lastSequence) {
        await deps.runner.consumeBusinessExecution?.(deps.taskId, executionId, after);
        return { ok: receipt.result?.reason === 'exited' && receipt.result.exitCode === 0, events, text, ...(sessionId ? { sessionId } : {}) };
      }
      if (Date.now() > deadline) throw new Error('业务能力测试超时');
      await Bun.sleep(deps.pollMs);
    }
  } catch (error) {
    await deps.runner.sendCommand(deps.taskId, { id: newResourceId(), type: 'cancelBusinessExecution', executionId }).catch(() => undefined);
    // Caller aborts this probe batch and releases the whole isolated Pod. No following turn reuses an unconfirmed session.
    throw error;
  }
}

/** Runner spools are cleared after session ACK; probes must read the durable consumer copy. */
export async function readProbeEvents(deps: BusinessProbeTurnDeps, executionId: string, after: number) {
  if (!deps.runner.getBusinessExecution || !deps.runner.listBusinessExecutionEvents) throw new Error('业务能力测试未配置持久事件读取');
  const stored = StoredBusinessExecutionSchema.parse(await deps.runner.getBusinessExecution(deps.taskId, executionId));
  const page = BusinessExecutionEventSchema.array().parse(await deps.runner.listBusinessExecutionEvents(deps.taskId, executionId, after, 200));
  return { stored, page };
}
