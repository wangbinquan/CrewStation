import type { RunnerBusinessEvent, RunnerEvent, TaskId } from '@crewstation/contracts';
import type { Logger } from '@crewstation/kernel';
import type { AgentCallSignal } from '../domain/agentCallSignals';
import { agentEventSignal, runnerEventSignal } from '../domain/agentCallSignals';
import type { AgentCallSink } from '../ports/agentCallSink';

/** 转交一条信号；观测写入失败只告警，绝不影响 Runner 事件或业务执行的持久化。 */
async function forward(sink: AgentCallSink, logger: Logger, runtimeTaskId: TaskId, signal: AgentCallSignal, at: Date): Promise<void> {
  const target = { runtimeTaskId, agentId: signal.agentId };
  try {
    if (signal.kind === 'usage') await sink.usage(target, signal.snapshot);
    else await sink.finish(target, { status: signal.status, at, snapshot: signal.snapshot });
  } catch (error) {
    logger.warn('agent call observation unavailable', { taskId: runtimeTaskId, agentId: signal.agentId, error: error instanceof Error ? error.message : String(error) });
  }
}

/** Runner 普通事件（开发 Agent、档位测试与「＋ CLI」终端）。 */
export async function forwardRunnerEvent(sink: AgentCallSink | undefined, logger: Logger, runtimeTaskId: TaskId, event: RunnerEvent, at: Date): Promise<void> {
  const signal = sink ? runnerEventSignal(event) : null;
  if (sink && signal) await forward(sink, logger, runtimeTaskId, signal, at);
}

/** 可靠业务执行日志里的 Agent 帧（按序转交；重复转交是幂等的：快照整份替换，终态只写一次）。 */
export async function forwardBusinessEvents(sink: AgentCallSink | undefined, logger: Logger, runtimeTaskId: TaskId, events: readonly RunnerBusinessEvent[]): Promise<void> {
  if (!sink) return;
  for (const event of events) {
    if (event.frame.type !== 'agent') continue;
    const signal = agentEventSignal(event.frame.event);
    if (signal) await forward(sink, logger, runtimeTaskId, signal, new Date(event.occurredAt));
  }
}
