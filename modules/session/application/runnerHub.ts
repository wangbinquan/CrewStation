import type { RunnerMessage, TaskId } from '@crewstation/contracts';
import { RunnerMessageSchema, TASKRUNNER_PROTOCOL_VERSION } from '@crewstation/contracts';
import { isDurable } from '../domain/eventDurability';
import type { EventSink } from '../domain/runnerConnection';
import { RunnerConnection } from '../domain/runnerConnection';
import type { SessionUseCaseDeps } from './dependencies';

export type RunnerOpenResult = { ok: true; connection: RunnerConnection } | { ok: false; code: string; message: string };

/** TaskRunner 出向连接的服务端语义：hello 校验令牌、welcome 给出续接 seq、事件去重落库并广播、结果关联命令。 */
export function runnerHub(deps: SessionUseCaseDeps) {
  const connections = new Map<TaskId, RunnerConnection>();
  const subscribers = new Map<TaskId, Set<EventSink>>();
  const { logger } = deps;

  const onHello = async (raw: unknown, socket: EventSink): Promise<RunnerOpenResult> => {
    const parsed = RunnerMessageSchema.safeParse(raw);
    if (!parsed.success || parsed.data.type !== 'hello') return { ok: false, code: 'bad_hello', message: '首帧必须是 hello' };
    const hello = parsed.data;
    const auth = await deps.runnerAuth.verifyRunnerToken(hello.taskId, hello.runnerToken);
    if (!auth.ok) return { ok: false, code: 'unauthorized', message: auth.reason };
    const resumeFromSeq = await deps.events.maxSeq(hello.taskId);
    if (await deps.taskAccess.onRunnerConnected(hello.taskId, hello.runnerToken) === false) return { ok: false, code: 'unauthorized', message: '环境已变化，请由当前容器重新连接' };
    const previous = connections.get(hello.taskId);
    if (previous) previous.pending.failAll('TaskRunner 重新连接');
    const now = deps.clock.now();
    const connection = new RunnerConnection(hello, socket, resumeFromSeq, deps.settings.commandTimeoutMs, now.getTime());
    for (const sub of subscribers.get(hello.taskId) ?? []) connection.subscribers.add(sub);
    connections.set(hello.taskId, connection);
    await deps.registry.claim(hello.taskId, deps.settings.selfAddress, now);
    socket.send(JSON.stringify({ type: 'welcome', protocolVersion: TASKRUNNER_PROTOCOL_VERSION, resumeFromSeq, nativeActivityVersion: 1 }));
    deps.taskAccess.onRunnerReady?.(hello.taskId);
    connection.broadcast(JSON.stringify({ type: 'runnerReconnected' }));
    logger.info('runner connected', { taskId: hello.taskId, resumeFromSeq, drivers: hello.capabilities.drivers });
    return { ok: true, connection };
  };

  const onMessage = async (connection: RunnerConnection, raw: unknown): Promise<void> => {
    if (connections.get(connection.hello.taskId) !== connection) return;
    const parsed = RunnerMessageSchema.safeParse(raw);
    if (!parsed.success) { logger.warn('invalid runner frame', { taskId: connection.hello.taskId }); return; }
    const message: RunnerMessage = parsed.data;
    const now = deps.clock.now();
    connection.lastSeenAt = now.getTime();
    switch (message.type) {
      case 'result': connection.pending.settle(message.id, { ok: true, payload: message.payload }); return;
      case 'error': connection.pending.settle(message.id, { ok: false, code: message.code, message: message.message }); return;
      case 'pong': return;
      case 'hello': return;
      case 'event': {
        if (!connection.accept(message.seq, now.getTime())) return;
        if (isDurable(message.event)) await deps.events.append({ taskId: connection.hello.taskId, seq: message.seq, at: new Date(message.at), event: message.event });
        connection.broadcast(RunnerConnection.frameOf(message.seq, message.at, message.event));
        return;
      }
    }
  };

  const onClose = async (connection: RunnerConnection): Promise<void> => {
    if (connections.get(connection.hello.taskId) !== connection) return;
    connections.delete(connection.hello.taskId);
    connection.pending.failAll('TaskRunner 连接已断开');
    connection.broadcast(JSON.stringify({ type: 'runnerDisconnected' }));
    await deps.registry.release(connection.hello.taskId, deps.settings.selfAddress);
    await deps.taskAccess.onRunnerDisconnected(connection.hello.taskId, connection.hello.runnerToken);
    logger.info('runner disconnected', { taskId: connection.hello.taskId });
  };

  /** 定时：过期命令、失联连接、注册表心跳。 */
  const tick = async (): Promise<void> => {
    const now = deps.clock.now();
    for (const [taskId, connection] of connections) {
      connection.pending.expire(now.getTime());
      if (now.getTime() - connection.lastSeenAt > deps.settings.runnerStaleMs) { connection.socket.send(JSON.stringify({ type: 'ping', at: now.toISOString() })); }
      await deps.registry.heartbeat(taskId, deps.settings.selfAddress, now);
    }
  };

  const subscribe = (taskId: TaskId, sink: EventSink) => {
    const set = subscribers.get(taskId) ?? new Set<EventSink>();
    subscribers.set(taskId, set);
    set.add(sink);
    connections.get(taskId)?.subscribers.add(sink);
    return () => {
      set.delete(sink);
      if (set.size === 0) subscribers.delete(taskId);
      connections.get(taskId)?.subscribers.delete(sink);
    };
  };
  return { connections, subscribe, onHello, onMessage, onClose, tick };
}

export type RunnerHub = ReturnType<typeof runnerHub>;
/** http 层只经 application 认识连接对象。 */
export type ActiveRunnerConnection = RunnerConnection;
