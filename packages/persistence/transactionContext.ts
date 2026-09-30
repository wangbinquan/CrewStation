import { AsyncLocalStorage } from 'node:async_hooks';
import type { Database, Transaction } from './databaseTypes';
import { sql } from 'drizzle-orm';

interface Scope { readonly database: Database; readonly key: string; readonly keys: readonly string[]; readonly backend: number; readonly transaction: Transaction; active: boolean }
const scopes = new AsyncLocalStorage<Scope>();
const guards = new WeakMap<Database, () => Database>();

/** 普通 UOW 仍独立提交；只有显式 shared 准入上下文向事务注入实际锁持有者身份。 */
export function contextualDatabase(database: Database, guard: () => Database): Database {
  const transaction = database.transaction.bind(database);
  database.transaction = <T>(work: (tx: Transaction) => Promise<T>, config?: Parameters<Database['transaction']>[1]) => {
    const scope = scopes.getStore();
    if (!scope?.active || scope.database !== database) return transaction(work, config);
    return transaction(async (tx) => {
      await tx.execute(sql`SELECT set_config('crewstation.shared_admission_pid', ${String(scope.backend)}, true),set_config('crewstation.shared_admission_key', ${scope.key}, true),set_config('crewstation.shared_admission_keys', ${JSON.stringify(scope.keys)}, true)`);
      return work(tx);
    }, config);
  };
  // 只包装事务入口，保留真实数据库对象及普通查询方法，原查询监测仍能观测 N+1。
  guards.set(database, guard); return database;
}
/**
 * 锁使用独立的小连接池，回调不占普通 UOW 的池容量。
 * SQL 触发器须验证注入的 backend 当前确实持有本 key 的 shared 锁；不能只信会话变量。
 * 这样排他 seal 等待时，在途回调的已授权写仍能完成；成功 UOW 不因后续外部错误回滚。
 */
export function withSharedDatabaseAdmission<T>(db: Database, key: string, work: (transaction: Transaction) => Promise<T>): Promise<T> {
  const current = scopes.getStore();
  if (current?.active && current.database === db && current.keys.includes(key)) return work(current.transaction);
  const guard = guards.get(db); if (!guard) throw new Error('Database admission requires connectDatabase');
  let admitted: Scope | undefined;
  return admissionTransaction(guard(), async (transaction) => {
    await transaction.execute(sql`SELECT pg_advisory_xact_lock_shared(hashtextextended(${key},0))`);
    const backend = Number((await transaction.execute<{ pid: number }>(sql`SELECT pg_backend_pid() AS pid`))[0]!.pid);
    const scope: Scope = { database: db, key, keys: [key], backend, transaction, active: true }; admitted = scope;
    try { return await scopes.run(scope, () => work(transaction)); }
    finally { scope.active = false; }
  }, () => { if (admitted) admitted.active = false; });
}

/** 一个实际 backend 按稳定次序保护多个来源；普通 UOW 可验证每个 key 的真实 shared 锁。 */
export function withSharedDatabaseAdmissions<T>(db: Database, requested: readonly string[], work: (transaction: Transaction) => Promise<T>): Promise<T> {
  const keys = [...new Set(requested)].sort();
  if (!keys.length || keys.some((key) => !key.length)) throw new Error('Shared admission requires nonempty keys');
  const current = scopes.getStore();
  if (current?.active && current.database === db) {
    if (keys.every((key) => current.keys.includes(key))) return work(current.transaction);
    throw new Error('Cannot expand an active shared admission');
  }
  const guard = guards.get(db); if (!guard) throw new Error('Database admission requires connectDatabase');
  let admitted: Scope | undefined;
  return admissionTransaction(guard(), async (transaction) => {
    for (const key of keys) await transaction.execute(sql`SELECT pg_advisory_xact_lock_shared(hashtextextended(${key},0))`);
    const backend = Number((await transaction.execute<{ pid: number }>(sql`SELECT pg_backend_pid() AS pid`))[0]!.pid);
    const scope: Scope = { database: db, key: keys[0]!, keys, backend, transaction, active: true }; admitted = scope;
    try { return await scopes.run(scope, () => work(transaction)); }
    finally { scope.active = false; }
  }, () => { if (admitted) admitted.active = false; });
}

function admissionTransaction<T>(database: Database, work: (transaction: Transaction) => Promise<T>, unavailableCallback?: () => void): Promise<T> {
  let unavailable = false;
  const pending = database.transaction(async (transaction) => {
    try { const result = await work(transaction); return unavailable ? abandonedAdmission<T>() : result; }
    catch (error) { if (unavailable) return abandonedAdmission<T>(); throw error; }
  });
  return pending.catch((error) => { unavailable = true; unavailableCallback?.(); throw error; });
}

/**
 * postgres.js 在连接关闭时已经拒绝外层事务，但外部回调仍可能继续。
 * 废弃它的内部 scope，避免随后向已关闭的 socket 发送 COMMIT／ROLLBACK。
 * 调用方收到原断线错误；持久在途 owner 仍需证明外部回调退出。
 */
function abandonedAdmission<T>(): Promise<T> {
  return new Promise<T>(() => { /* 外层已拒绝，断开的驱动 scope 不再执行终结查询。 */ });
}

/** 排他封闭也使用准入池，避免等待 shared 回调时占满它完成 UOW 所需的普通连接。 */
export function withExclusiveDatabaseAdmission<T>(db: Database, key: string, work: (transaction: Transaction) => Promise<T>): Promise<T> {
  const current = scopes.getStore();
  if (current?.active && current.database === db && current.keys.includes(key)) throw new Error('Cannot seal an active shared admission');
  const guard = guards.get(db); if (!guard) throw new Error('Database admission requires connectDatabase');
  return admissionTransaction(guard(), async (transaction) => {
    await transaction.execute(sql`SET LOCAL lock_timeout = '30s'`);
    await transaction.execute(sql`SELECT pg_advisory_xact_lock(hashtextextended(${key},0))`);
    return work(transaction);
  });
}
