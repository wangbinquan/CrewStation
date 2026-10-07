import type { TaskId } from '@crewstation/contracts';
import { jsonHash, newResourceId, precondition } from '@crewstation/kernel';
import { SessionBirthSchema } from '../domain/projectDeletion';
import type { EventSink, RunnerConnection, RunnerOpenResult } from '../domain/runnerConnection';
import type { SessionConnectionBirth } from '../ports/projectDeletion';
import type { SessionUseCaseDeps } from './dependencies';

function originalCallback<T>(raw: SessionConnectionBirth, address: string, connections: Map<TaskId, RunnerConnection>,
  births: WeakMap<RunnerConnection, { original: SessionConnectionBirth; privateKey: string }>, retiring: Map<string, RunnerConnection>,
  action: (connection: RunnerConnection, privateKey: string) => Promise<T>): Promise<T> {
  const original = SessionBirthSchema.parse(structuredClone(raw));
  const connection = connections.get(original.taskId), birth = connection ? births.get(connection) : undefined;
  if (!connection || connection.closed || retiring.has(original.id) || !birth || jsonHash(birth.original) !== jsonHash(original)
    || original.replica !== address) return Promise.reject(precondition('会话清理缺少本副本原连接的私有许可'));
  return connection.command(async () => {
    if (connection.closed || connections.get(original.taskId) !== connection || births.get(connection) !== birth)
      throw precondition('会话原连接已退出，不能发起新的清理回调');
    return action(connection, birth.privateKey);
  });
}

/** Keep the real birth and its private exit key even if its admission transaction fails. */
async function registerOriginalConnection(deps: Pick<SessionUseCaseDeps, 'connectionHistory' | 'registry' | 'settings'>,
  births: WeakMap<RunnerConnection, { original: SessionConnectionBirth; privateKey: string }>, connection: RunnerConnection,
  now: Date, stopping: () => boolean): Promise<void> {
  const assertStarting = () => { if (stopping()) throw precondition('会话服务正在停止，不能登记新的连接'); };
  // An already admitted hello must retain its real birth through shutdown.
  // The outer open rejects later hellos; the final check prevents welcome.
  const history = deps.connectionHistory;
  if (!history) {
    await deps.registry.claim(connection.hello.taskId, deps.settings.selfAddress, now);
    assertStarting(); return;
  }
  const privateKey = Array.from(crypto.getRandomValues(new Uint8Array(32)), (value) => value.toString(16).padStart(2, '0')).join('');
  let issued: Promise<void> | undefined;
  try {
    // Only the fresh original birth holds Session's guard. Welcome and ready
    // leave this scope, after the original durable registration has finished.
    await history.open(connection.hello.taskId, () => {
      issued = history.birth({ id: newResourceId(), taskId: connection.hello.taskId, replica: deps.settings.selfAddress,
        at: now.toISOString(), exitKeyHash: jsonHash(privateKey) }).then((original) => { births.set(connection, { original, privateKey }); });
      return issued;
    });
  } catch (error) {
    // A driver rejection can precede the issued birth's actual settlement.
    // Caller finish must retain its original permission and await that work.
    await issued?.catch(() => undefined); throw error;
  }
  assertStarting();
}

/** Own the original connection's private exit permission until every callback has drained and its durable exit is saved. */
export function runnerLifetime(deps: Pick<SessionUseCaseDeps, 'connectionHistory' | 'taskAccess' | 'registry' | 'settings'>, connections: Map<TaskId, RunnerConnection>, subscribers: Map<TaskId, Set<EventSink>>) {
  const births = new WeakMap<RunnerConnection, { original: SessionConnectionBirth; privateKey: string }>();
  const finishing = new WeakMap<RunnerConnection, Promise<void>>();
  const exiting = new Set<Promise<void>>();
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
    exiting.add(pending);
    void pending.then(() => exiting.delete(pending), () => { exiting.delete(pending); finishing.delete(connection); });
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
    /** Private local capability: bind the captured birth and keep its finally behind the complete cleanup callback. */
    withOriginal: <T>(raw: SessionConnectionBirth, action: (connection: RunnerConnection, privateKey: string) => Promise<T>): Promise<T> =>
      originalCallback(raw, deps.settings.selfAddress, connections, births, retiring, action),
    bind: <T>(taskId: TaskId, action: () => Promise<T>): Promise<T> => {
      const pending = (bindings.get(taskId) ?? Promise.resolve()).then(action), tail = pending.then(() => undefined, () => undefined);
      bindings.set(taskId, tail);
      void tail.then(() => { if (bindings.get(taskId) === tail) bindings.delete(taskId); });
      return pending;
    },
    open: (hello: (raw: unknown, socket: EventSink) => Promise<RunnerOpenResult>) => (raw: unknown, socket: EventSink): Promise<RunnerOpenResult> => {
      if (stopping) return Promise.resolve({ ok: false, code: 'service-stopping', message: '会话服务正在停止，请重新连接' });
      // Each owner admits its own hello callbacks. Holding Session's guard
      // while TaskRuntime needs the same finite pool creates a circular wait.
      const pending = hello(raw, socket).then(async (result) => {
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
      // onClose removes its connection before the private finally and
      // registry release complete. Service shutdown owns those exits too.
      await Promise.all([...exiting]);
    }, register: (connection: RunnerConnection, now: Date) => registerOriginalConnection(deps, births, connection, now, () => stopping),
  };
}
