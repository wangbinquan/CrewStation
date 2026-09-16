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

/**
 * 服务端会话默认值：事务内空闲 60s 由 PostgreSQL 主动断开。
 * 2026-09-16 实机：cs-api 一条持有咨询锁的事务空闲 8 分钟，其余 9 条连接全部排在锁后，API 整体 502；
 * 有了这个上限，同样的事务会在 60s 内被服务端终止并释放锁与连接。
 */
export const SESSION_OPTIONS = '-c idle_in_transaction_session_timeout=60000';

/** 没有显式 options 的连接串补上会话默认值；已带 options 的（运维自定）原样保留。 */
export function withSessionDefaults(url: string): string {
  const parsed = new URL(url);
  if (parsed.searchParams.has('options')) return url;
  const separator = parsed.search ? '&' : '?';
  parsed.search = `${parsed.search}${separator}options=${encodeURIComponent(SESSION_OPTIONS)}`;
  return parsed.toString();
}

export function connectDatabase(url: string, options: { max?: number } = {}): DatabaseHandle {
  const client = new SQL(withSessionDefaults(url), { max: options.max ?? 10 });
  const db = drizzle({ client });
  return { db, client, close: () => client.close() };
}

/** 把数据库地址里的库名替换掉，供测试库与恢复流程使用。 */
export function withDatabaseName(url: string, name: string): string {
  const parsed = new URL(url);
  parsed.pathname = `/${name}`;
  return parsed.toString();
}
