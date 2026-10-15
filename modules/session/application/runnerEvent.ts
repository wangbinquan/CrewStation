import type { RunnerMessage } from '@crewstation/contracts';
import {setRuntimeSignal,incrementRuntimeSignal,jsonHash } from '@crewstation/kernel';
import { RunnerConnection } from '../domain/runnerConnection';
import { isDurable } from '../domain/eventDurability';
import type { SessionUseCaseDeps } from './dependencies';
import { forwardRunnerEvent } from './agentCallForwarding';

export async function persistRunnerMessage(deps: SessionUseCaseDeps, connection: RunnerConnection,
  message: Extract<RunnerMessage, { type: 'event' }>, raw: unknown, now: Date) {
  const callback = async () => {
    if (!deps.projectWork) await deps.connectionHistory?.check(connection.hello.taskId);
    if (!connection.accept(message.seq, now.getTime())) return;
    if (isDurable(message.event)) await deps.events.append({ taskId: connection.hello.taskId, seq: message.seq, at: new Date(message.at), event: message.event,
      ...(connection.legacy ? { legacyEvent: (raw as { event: unknown }).event } : {}) });
    const lag=now.getTime()-Date.parse(message.at);if(Number.isFinite(lag)){setRuntimeSignal('runner.event.observedLag','milliseconds',String(Math.max(0,lag)));if(lag<0)incrementRuntimeSignal('runner.event.clockSkew','events');}
    connection.broadcast(RunnerConnection.frameOf(message.seq, message.at, message.event));
    // RFC-034 v2：持久化之后把 Agent 的用量快照与终态交给观测（按连接顺序处理，快照不会越过终态）。
    await forwardRunnerEvent(deps.agentCalls, deps.logger, connection.hello.taskId, message.event, new Date(message.at));
  };
  if (deps.projectWork) await deps.projectWork.run({ taskKey: connection.hello.taskId, kind: 'command', reference: 'event:' + message.seq,
    inputDigest: jsonHash(message) }, callback, connection.command.bind(connection));
  else await callback();
}
