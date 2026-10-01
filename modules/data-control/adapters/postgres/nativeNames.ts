import postgres from 'postgres';
import { precondition } from '@crewstation/kernel';
import { jsonHash } from '@crewstation/kernel';
import type { NativeDdlConnection } from '../../api/databaseRemoval';

type Native = Awaited<ReturnType<ReturnType<typeof postgres>['reserve']>>;
const key = (name: string) => 'crewstation.data-native-name:' + name;

/** Shared SQL-server identity; independent volume evidence remains separately required. */
export async function postgresServerSource(query: (text: string) => PromiseLike<readonly { system_identifier: string; pg_control_version: number; catalog_version_no: number; directory: string }[]>, endpoint: string): Promise<string> {
  const [row] = await query("SELECT system_identifier::text,pg_control_version,catalog_version_no,current_setting('data_directory') AS directory FROM pg_control_system()");
  if (!row || !/^[0-9]+$/.test(row.system_identifier) || !row.directory || !Number.isInteger(row.pg_control_version) || !Number.isInteger(row.catalog_version_no)) throw precondition('原 PostgreSQL 服务器来源不完整');
  return jsonHash({ endpoint, ...row });
}

/** A private reserved native session, never substituted with a pool connection after disconnect. */
export async function withNativePostgresNames<T>(adminUrl: string, names: readonly string[], effect: (connection: NativeDdlConnection) => Promise<T>, options?: { readonly tryOnly: true }): Promise<T> {
  const ordered = [...new Set(names)].sort(), held: string[] = [];
  if (!ordered.length || ordered.some((name) => !/^cs_[a-z0-9_]{1,60}$/.test(name))) throw precondition('原生数据库名字锁不合法');
  let closed = false;
  const stopped = Promise.withResolvers<never>(); stopped.promise.catch(() => undefined);
  const coordinator = new URL(adminUrl); coordinator.pathname = '/postgres';
  const pool = postgres(coordinator.toString(), { max: 1, onnotice: () => undefined, onclose: () => {
    closed = true; stopped.reject(precondition('原生数据库锁连接已退出，不能换连接继续副作用'));
  } });
  let native: Native | undefined;
  try {
    native = await pool.reserve();
    const query: NativeDdlConnection['query'] = async <Rows extends postgres.Row[] = postgres.Row[]>(text: string, parameters?: readonly (string | number | boolean | null)[]): Promise<Rows> => {
      if (closed) throw precondition('原生数据库锁连接已退出，不能换连接继续副作用');
      return Promise.race([native!.unsafe<Rows>(text, parameters ? [...parameters] : undefined), stopped.promise]);
    };
    const [binding] = await query<{ pid: number }[]>('SELECT pg_backend_pid() AS pid');
    for (const name of ordered) {
      if (options?.tryOnly) {
        const [row] = await query<{ acquired: boolean }[]>('SELECT pg_try_advisory_lock(hashtextextended($1,0)) AS acquired', [key(name)]);
        if (row?.acquired !== true) throw precondition('原生名字锁仍由原连接持有', { code: 'native_postgres_busy' });
      } else await query('SELECT pg_advisory_lock(hashtextextended($1,0))', [key(name)]);
      held.push(name);
    }
    const assertHeld = async () => {
      for (const name of held) {
        const [row] = await query<{ pid: number; held: boolean }[]>(
          "SELECT pg_backend_pid() AS pid,EXISTS(SELECT 1 FROM pg_locks WHERE locktype='advisory' AND pid=pg_backend_pid() AND granted AND mode='ExclusiveLock' AND objsubid=1 AND classid::bigint=((hashtextextended($1,0)>>32)&4294967295) AND objid::bigint=(hashtextextended($1,0)&4294967295)) AS held", [key(name)]);
        if (!binding || row?.pid !== binding.pid || !row.held) throw precondition('原生数据库名字锁来源失效');
      }
    };
    await assertHeld();
    return await effect({ query, assertHeld });
  } finally {
    try {
      if (native && !closed) {
        for (const name of held.reverse()) await native.unsafe('SELECT pg_advisory_unlock(hashtextextended($1,0))', [key(name)]);
        native.release();
      }
    } finally { await pool.end({ timeout: 5 }); }
  }
}
