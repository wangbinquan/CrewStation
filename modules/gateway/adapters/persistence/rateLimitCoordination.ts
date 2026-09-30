import type { Executor, Transaction } from '@crewstation/persistence';
import { conflict } from '@crewstation/kernel';
import { sql } from 'drizzle-orm';

export const coordinateRateLimits = <T>(db: Executor, work: (tx: Transaction) => Promise<T>) => db.transaction(async (tx) => {
  const rows = await tx.execute<{ acquired: boolean }>(sql`SELECT pg_try_advisory_xact_lock(hashtextextended('gateway-rate-limits', 0)) AS acquired`);
  if (!rows[0]?.acquired) throw conflict('网关限流正在更新，请重试');
  return work(tx);
});
