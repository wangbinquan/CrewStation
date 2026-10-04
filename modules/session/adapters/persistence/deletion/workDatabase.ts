import type { Database, Transaction } from '@crewstation/persistence';
import { jsonHash } from '@crewstation/kernel';
import { sql } from 'drizzle-orm';
import type { SessionWorkBirth } from '../../../domain/deletion/work';

export interface SessionWorkScope {
  readonly birth: SessionWorkBirth; readonly nonce: string; readonly effects: Set<Promise<unknown>>;
  active: boolean; accepting: boolean;
  check(): Promise<void>;
}
/** The tracker is entered inside the actual driver callback, which can outlive its rejected outer promise. */
export function sessionWorkDatabase(db: Database, current: () => SessionWorkScope | undefined): Database {
  const transaction: Database['transaction'] = (callback, config) => {
    const scope = current();
    if (!scope) return db.transaction(callback, config);
    const result = db.transaction(async (tx: Transaction) => {
      const pending = (async () => {
        await scope.check();
        await tx.execute(sql`SELECT set_config('crewstation.session_work_callback',${scope.birth.id},true),
          set_config('crewstation.session_work_key',${scope.nonce},true),set_config('crewstation.session_work_grant',${scope.birth.grant ? jsonHash(scope.birth.grant) : ''},true)`);
        const result = await callback(tx); await scope.check(); return result;
      })();
      scope.effects.add(pending);
      try { return await pending; } finally { scope.effects.delete(pending); }
    }, config);
    scope.effects.add(result);
    result.then(() => { scope.effects.delete(result); }, () => { scope.effects.delete(result); });
    return result;
  };
  return new Proxy(db, { get(target, property) {
    if (property === 'transaction') return transaction;
    if (property === 'execute') return (query: Parameters<Database['execute']>[0]) => current()
      ? transaction((tx) => tx.execute(query)) : target.execute(query);
    const value = Reflect.get(target, property, target);
    return typeof value === 'function' ? value.bind(target) : value;
  } });
}
