import type { RunnerMessage } from '@crewstation/contracts';
import { jsonHash } from '@crewstation/kernel';
import { RunnerConnection } from '../domain/runnerConnection';
import { isDurable } from '../domain/eventDurability';
import type { SessionUseCaseDeps } from './dependencies';

export async function persistRunnerMessage(deps: SessionUseCaseDeps, connection: RunnerConnection,
  message: Extract<RunnerMessage, { type: 'event' }>, raw: unknown, now: Date) {
  const callback = async () => {
    if (!deps.projectWork) await deps.connectionHistory?.check(connection.hello.taskId);
    if (!connection.accept(message.seq, now.getTime())) return;
    if (isDurable(message.event)) await deps.events.append({ taskId: connection.hello.taskId, seq: message.seq, at: new Date(message.at), event: message.event,
      ...(connection.legacy ? { legacyEvent: (raw as { event: unknown }).event } : {}) });
    connection.broadcast(RunnerConnection.frameOf(message.seq, message.at, message.event));
  };
  if (deps.projectWork) await deps.projectWork.run({ taskKey: connection.hello.taskId, kind: 'command', reference: 'event:' + message.seq,
    inputDigest: jsonHash(message) }, callback, connection.command.bind(connection));
  else await callback();
}
