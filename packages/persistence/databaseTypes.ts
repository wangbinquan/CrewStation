import type { drizzle } from 'drizzle-orm/postgres-js';

export type Database = ReturnType<typeof drizzle>;
export type Transaction = Parameters<Parameters<Database['transaction']>[0]>[0];
/** 用例层接受 Database 或 Transaction，便于在事务内复用同一段查询。 */
export type Executor = Database | Transaction;
