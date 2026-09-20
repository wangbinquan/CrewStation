import { conflict } from '@crewstation/kernel';
import { sql } from 'drizzle-orm';
import type { Database } from './connection';

/** Short, cross-process coordination. Contention never waits while holding a pooled connection. */
export function keyedLock(db: Database) {
  return async <T>(keys: readonly string[], work: () => Promise<T>): Promise<T> => {
    const deadline = Date.now() + 1500;
    const ordered = [...new Set(keys)].sort();
    do {
      const result = await db.transaction(async (tx) => {
        for (const key of ordered) {
          const rows = await tx.execute<{ acquired: boolean }>(sql`select pg_try_advisory_xact_lock(hashtextextended(${key}, 0)) as acquired`);
          if (!rows[0]?.acquired) return { kind: 'busy' as const };
        }
        // Release the coordination transaction normally, including when a module rejects a mutation.
        try { return { kind: 'done' as const, value: await work() }; }
        catch (error) { return { kind: 'failed' as const, error }; }
      });
      if (result.kind === 'done') return result.value;
      if (result.kind === 'failed') throw result.error;
      await Bun.sleep(100);
    } while (Date.now() < deadline);
    throw conflict('权限正在更新，请稍后重试');
  };
}
