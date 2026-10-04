import { AsyncLocalStorage } from 'node:async_hooks';
import { ProjectDeletionContextSchema } from '@crewstation/contracts';
import type { ProjectDeletionContext } from '@crewstation/contracts';
import { precondition } from '@crewstation/kernel';
import type { Database, Executor } from '@crewstation/persistence';
import { assertSharedDatabaseAdmissionActive, withSharedDatabaseAdmission } from '@crewstation/persistence';
import { sql } from 'drizzle-orm';
import { SessionWorkInputSchema } from '../../../domain/deletion/work';
import type { SessionWorkInput } from '../../../domain/deletion/work';
import type { SessionDeletionSources } from '../../../ports/projectDeletion';
import type { SessionProjectWork, SessionWorkHandle, SessionWorkTracker } from '../../../ports/projectWork';
import { readSessionTask } from './identity';
import { sessionWorkDatabase } from './workDatabase';
import type { SessionWorkScope } from './workDatabase';
import { exitSessionWork, renewSessionStop, sessionWorkBirth, sessionWorkKey } from './workStore';

interface Lifetime { readonly scopes: AsyncLocalStorage<SessionWorkScope>; readonly pending: Set<Promise<unknown>> }
async function admitted<T>(db: Database, sources: SessionDeletionSources, life: Lifetime, protectedTx: Executor,
  input: SessionWorkInput, callback: (handle: SessionWorkHandle) => Promise<T>, context?: ProjectDeletionContext) {
  const retained = Promise.withResolvers<void>(); life.pending.add(retained.promise);
  try {
    const { birth, nonce } = await sessionWorkBirth(db, sources, protectedTx, input, context);
    const scope: SessionWorkScope = { birth, nonce, effects: new Set(), active: true, accepting: true, check: async () => {
      if (!scope.active) throw precondition('会话原命令回调已退出');
      assertSharedDatabaseAdmissionActive(db, sessionWorkKey(birth.projectId));
      const origin = await readSessionTask(sources, birth.taskKey);
      if (origin.id !== birth.taskId || origin.projectId !== birth.projectId || origin.identity !== birth.originRevision)
        throw precondition('会话原命令来源已经替换');
      if (context) await sources.assertGrant(context);
      await protectedTx.execute(sql`SELECT 1`);
      assertSharedDatabaseAdmissionActive(db, sessionWorkKey(birth.projectId));
    } };
    return await life.scopes.run(scope, async () => {
      const handle: SessionWorkHandle = { check: scope.check, retain: async (effect) => {
        if (!scope.accepting) throw precondition('会话原命令不再接受新的副作用');
        const pending = (async () => { await scope.check(); const result = await effect(); await scope.check(); return result; })();
        scope.effects.add(pending);
        try { return await pending; } finally { scope.effects.delete(pending); }
      } };
      try { await scope.check(); const result = await callback(handle); await scope.check(); return result; }
      finally {
        scope.accepting = false;
        while (scope.effects.size) await Promise.allSettled([...scope.effects]);
        scope.active = false; await exitSessionWork(db, birth, nonce);
      }
    });
  } finally { retained.resolve(); life.pending.delete(retained.promise); }
}

export function sessionProjectWork(db: Database, sources: SessionDeletionSources): SessionProjectWork & { readonly database: Database } {
  const life: Lifetime = { scopes: new AsyncLocalStorage(), pending: new Set() };
  const run = async <T>(raw: SessionWorkInput, callback: (handle: SessionWorkHandle) => Promise<T>, track?: SessionWorkTracker, context?: ProjectDeletionContext) => {
    const input = SessionWorkInputSchema.parse(structuredClone(raw));
    if (life.scopes.getStore()) throw precondition('会话原命令不能替换或扩展当前回调');
    if ((input.kind === 'cleanup') !== !!context) throw precondition('会话清理命令缺少当前私有许可');
    if (context) await renewSessionStop(db, sources, context);
    const origin = await readSessionTask(sources, input.taskKey);
    return withSharedDatabaseAdmission(db, sessionWorkKey(origin.projectId), (tx) => {
      const callbackBody = () => admitted(db, sources, life, tx, input, callback, context);
      return track ? track(callbackBody) : callbackBody();
    });
  };
  return { database: sessionWorkDatabase(db, () => life.scopes.getStore()),
    run: (input, callback, track) => run(input, callback, track),
    runGranted: (raw, input, callback, track) => {
      const context = ProjectDeletionContextSchema.parse(structuredClone(raw));
      if (context.phase !== 'stop' || context.confirmed.participant !== 'session') throw precondition('会话清理命令只接受 Session 原 stop 许可');
      return run(input, callback, track, context);
    },
    drain: async () => { while (life.pending.size) await Promise.allSettled([...life.pending]); },
  };
}
