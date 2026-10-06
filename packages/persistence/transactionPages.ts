import { createHash } from 'node:crypto';
import { sql } from 'drizzle-orm';
import type { SQL } from 'drizzle-orm';
import { PgDialect } from 'drizzle-orm/pg-core';
import type { Executor } from './databaseTypes';

const active = new WeakMap<Executor, Set<string>>();
const dialect = new PgDialect();
/** Read a SELECT without LIMIT/OFFSET to EOF on an existing transaction. Its order is preserved; large relations are sorted at most twice. */
export async function readTransactionPages<Row extends Record<string, unknown>>(
  transaction: Executor, query: SQL, visit: (rows: Row[]) => Promise<void>,
): Promise<void> {
  const first = await transaction.execute<Row>(sql`${query} LIMIT 501`);
  if (first.length <= 500) {
    for (let offset = 0; offset < first.length; offset += 200) await visit(first.slice(offset, offset + 200) as Row[]);
    return;
  }
  // Discard the size probe: the cursor owns every result and its snapshot, including the first page.
  const names = active.get(transaction) ?? new Set<string>(); active.set(transaction, names);
  const prefix = 'cs_read_' + createHash('sha256').update(dialect.sqlToQuery(query).sql).digest('hex').slice(0, 16);
  let index = 0; while (names.has(prefix + '_' + index)) index++;
  const name = prefix + '_' + index, cursor = sql.identifier(name); names.add(name);
  let declared = false, completed = false;
  try {
    // Stable names reuse driver preparation; the SELECT hash keeps each FETCH result shape distinct.
    await transaction.execute(sql`DECLARE ${cursor} NO SCROLL CURSOR FOR ${query}`); declared = true;
    for (;;) {
      const rows = await transaction.execute<Row>(sql`FETCH FORWARD 200 FROM ${cursor}`);
      if (!rows.length) { completed = true; return; }
      await visit([...rows] as Row[]);
    }
  } finally {
    // A failed query can abort the transaction; preserve that failure instead of replacing it with CLOSE's error.
    try {
      if (declared) await transaction.execute(sql`CLOSE ${cursor}`);
    } catch (error) { if (completed) throw error; }
    finally { names.delete(name); }
  }
}
