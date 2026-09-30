import type { Database, Transaction } from '@crewstation/persistence';
import { conflict } from '@crewstation/kernel';
import { sql } from 'drizzle-orm';

/** Only short database work runs while holding this bounded, cross-process try lock. */
export async function resourceAccessTransaction<T>(db: Database, key: string, work: (tx: Transaction) => Promise<T>): Promise<T> {
  const deadline = Date.now() + 1500;
  for (;;) {
    const result = await db.transaction(async (tx) => {
      const rows = await tx.execute<{ acquired: boolean }>(sql`SELECT pg_try_advisory_xact_lock(hashtextextended(${`resource-access:${key}`}, 0)) AS acquired`);
      if (!rows[0]?.acquired) return { busy: true as const };
      return { busy: false as const, value: await work(tx) };
    });
    if (!result.busy) return result.value;
    if (Date.now() >= deadline) throw conflict('资源申请正在更新，请稍后重试');
    await Bun.sleep(75);
  }
}
