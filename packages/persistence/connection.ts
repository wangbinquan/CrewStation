import { sql } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { contextualDatabase } from './transactionContext';
import type { Database } from './databaseTypes';

export type { Database, Transaction, Executor } from './databaseTypes';

export interface DatabaseHandle {
  readonly db: Database;
  readonly client: postgres.Sql;
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

/**
 * 连接池（RFC-023，替换 Bun 内置 SQL，I16）：上限 10、连接超时 10 秒；空闲 60 秒的连接回收，每条连接最长用 30 分钟
 * （到期时等进行中的查询结束再换新）。连接串里的 options 由 postgres.js 作为启动参数发给服务端，会话默认值照旧生效。
 * 服务端提示（NOTICE，例如迁移里的「已存在，跳过」）不打印，与 Bun 内置驱动时一样。
 */
export const POOL_OPTIONS = { connect_timeout: 10, idle_timeout: 60, max_lifetime: 30 * 60, onnotice: () => undefined } as const;

export function connectDatabase(url: string, options: { max?: number } = {}): DatabaseHandle {
  const client = postgres(withSessionDefaults(url), { max: options.max ?? 10, ...POOL_OPTIONS });
  // 只有实际跨事务准入使用时才创建连接；不挤占普通查询／UOW 的连接池。
  let guardClient: postgres.Sql | undefined, guardDb: Database | undefined;
  const db = contextualDatabase(drizzle({ client }), () => {
    guardClient ??= postgres(withSessionDefaults(url), { max: 4, ...POOL_OPTIONS });
    return guardDb ??= drizzle({ client: guardClient });
  });
  // 关闭时等进行中的查询最多 5 秒，再强制断开，落在终止宽限期之内。
  return { db, client, close: async () => { await Promise.all([client.end({ timeout: 5 }), guardClient?.end({ timeout: 5 })]); } };
}

/** 就绪探针用：走同一连接池的最小查询；池被占满或连接失步时它会和业务请求一起卡住，正是探针要发现的。 */
export async function databaseReady(db: Database): Promise<void> {
  await db.execute(sql`select 1`);
}

/** 把数据库地址里的库名替换掉，供测试库与恢复流程使用。 */
export function withDatabaseName(url: string, name: string): string {
  const parsed = new URL(url);
  parsed.pathname = `/${name}`;
  return parsed.toString();
}
