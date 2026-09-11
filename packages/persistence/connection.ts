import { SQL } from 'bun';
import { drizzle } from 'drizzle-orm/bun-sql';

export type Database = ReturnType<typeof drizzle>;
export type Transaction = Parameters<Parameters<Database['transaction']>[0]>[0];
/** 用例层接受 Database 或 Transaction，便于在事务内复用同一段查询。 */
export type Executor = Database | Transaction;

export interface DatabaseHandle {
  readonly db: Database;
  readonly client: SQL;
  close(): Promise<void>;
}

export function connectDatabase(url: string, options: { max?: number } = {}): DatabaseHandle {
  const client = new SQL(url, { max: options.max ?? 10 });
  const db = drizzle({ client });
  return { db, client, close: () => client.close() };
}

/** 把数据库地址里的库名替换掉，供测试库与恢复流程使用。 */
export function withDatabaseName(url: string, name: string): string {
  const parsed = new URL(url);
  parsed.pathname = `/${name}`;
  return parsed.toString();
}
