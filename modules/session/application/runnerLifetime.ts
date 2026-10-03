import type { TaskId } from '@crewstation/contracts';
import { jsonHash, newResourceId } from '@crewstation/kernel';
import type { EventSink, RunnerConnection, RunnerOpenResult } from '../domain/runnerConnection';
import type { SessionConnectionBirth } from '../ports/projectDeletion';
import type { SessionUseCaseDeps } from './dependencies';

/** Own the original connection's private exit permission until every callback has drained and its durable exit is saved. */
export function runnerLifetime(deps: SessionUseCaseDeps, connections: Map<TaskId, RunnerConnection>, subscribers: Map<TaskId, Set<EventSink>>) {
  const births = new WeakMap<RunnerConnection, { original: SessionConnectionBirth; privateKey: string }>();
  const finishing = new WeakMap<RunnerConnection, Promise<void>>();
  const closing = new Map<string, Promise<void>>(), retiring = new Map<string, RunnerConnection>();
  const opening = new Set<Promise<RunnerOpenResult>>();
  const bindings = new Map<TaskId, Promise<void>>();
  let stopping = false;
  const finish = (connection: RunnerConnection, reason: string, notify = false): Promise<void> => {
    const current = finishing.get(connection); if (current) return current;
    const pending = (async () => {
      const birth = births.get(connection), token = connection.hello.runnerToken;
      if (birth) retiring.set(birth.original.id, connection);
      await connection.close(reason);
      let callbackFailure: unknown;
      try { if (notify) await deps.taskAccess.onRunnerDisconnected(connection.hello.taskId, token); } catch (error) { callbackFailure = error; }
      if (birth) {
        await deps.connectionHistory!.exit(birth.original, birth.privateKey);
        retiring.delete(birth.original.id); births.delete(connection);
      }
      await deps.registry.release(connection.hello.taskId, deps.settings.selfAddress, birth?.original.id);
      if (callbackFailure) throw callbackFailure;
    })();
    finishing.set(connection, pending);
    void pending.catch(() => finishing.delete(connection));
    return pending;
  };
  const drain = (original: SessionConnectionBirth): Promise<boolean> => {
    const existing = closing.get(original.id);
    if (existing) return existing.then(() => true);
    const connection = retiring.get(original.id) ?? connections.get(original.taskId), birth = connection ? births.get(connection) : undefined;
    if (!connection || !birth || jsonHash(birth.original) !== jsonHash(original)) return Promise.resolve(false);
    if (connections.get(original.taskId) === connection) connections.delete(original.taskId);
    retiring.set(original.id, connection);
    const pending = (async () => {
      for (const sink of subscribers.get(original.taskId) ?? []) sink.close?.(1008, '项目正在清理');
      subscribers.delete(original.taskId);
      await finish(connection, '项目正在清理');
    })();
    closing.set(original.id, pending);
    void pending.then(() => closing.delete(original.id), () => closing.delete(original.id));
    return pending.then(() => true);
  };
  return { finish, drain,
    bind: <T>(taskId: TaskId, action: () => Promise<T>): Promise<T> => {
      const pending = (bindings.get(taskId) ?? Promise.resolve()).then(action), tail = pending.then(() => undefined, () => undefined);
      bindings.set(taskId, tail);
      void tail.then(() => { if (bindings.get(taskId) === tail) bindings.delete(taskId); });
      return pending;
    },
    open: (hello: (raw: unknown, socket: EventSink) => Promise<RunnerOpenResult>) => (raw: unknown, socket: EventSink): Promise<RunnerOpenResult> => {
      if (stopping) return Promise.resolve({ ok: false, code: 'service-stopping', message: '会话服务正在停止，请重新连接' });
      const taskId = raw && typeof raw === 'object' && 'taskId' in raw ? raw.taskId : undefined;
      const original = deps.connectionHistory && typeof taskId === 'string' ? deps.connectionHistory.open(taskId as TaskId, () => hello(raw, socket)) : hello(raw, socket);
      const pending = original.then(async (result) => {
        if (!stopping || !result.ok) return result;
        if (connections.get(result.connection.hello.taskId) === result.connection) connections.delete(result.connection.hello.taskId);
        await finish(result.connection, '会话服务正在停止', true);
        return { ok: false as const, code: 'service-stopping', message: '会话服务正在停止，请重新连接' };
      });
      opening.add(pending); void pending.finally(() => opening.delete(pending)).catch(() => undefined); return pending;
    },
    shutdown: async () => {
      stopping = true; await Promise.allSettled([...opening]);
      await Promise.all([...connections.values()].map(async (connection) => {
        connections.delete(connection.hello.taskId); await finish(connection, '会话服务正在停止', true);
      }));
    }, register: async (connection: RunnerConnection, now: Date) => {
    if (!deps.connectionHistory) { await deps.registry.claim(connection.hello.taskId, deps.settings.selfAddress, now); return; }
    const privateKey = Array.from(crypto.getRandomValues(new Uint8Array(32)), (value) => value.toString(16).padStart(2, '0')).join('');
    const original = await deps.connectionHistory.birth({ id: newResourceId(), taskId: connection.hello.taskId, replica: deps.settings.selfAddress, at: now.toISOString(), exitKeyHash: jsonHash(privateKey) });
    births.set(connection, { original, privateKey });
  } };
}
