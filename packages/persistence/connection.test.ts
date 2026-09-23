import { describe, expect, test } from 'bun:test';
import { sql } from 'drizzle-orm';
import { DEFAULT_TEST_DATABASE_URL, testDatabaseAvailable } from '@crewstation/testkit';
import { POOL_OPTIONS, SESSION_OPTIONS, connectDatabase, databaseReady, withSessionDefaults } from './connection';

const available = await testDatabaseAvailable();

describe('withSessionDefaults', () => {
  test('无 options 的连接串补上事务内空闲上限，其余部分不变', () => {
    const url = withSessionDefaults('postgres://u:p@db.local:5432/crewstation');
    const parsed = new URL(url);
    expect(parsed.searchParams.get('options')).toBe(SESSION_OPTIONS);
    expect(parsed.pathname).toBe('/crewstation');
    expect(parsed.username).toBe('u');
    // libpq 风格：空格与等号编码后原样交给服务端启动参数。
    expect(url).toContain('options=-c%20idle_in_transaction_session_timeout%3D60000');
  });

  test('已有查询参数时用 & 追加；已有 options 时原样保留', () => {
    expect(new URL(withSessionDefaults('postgres://u:p@db.local:5432/crewstation?sslmode=require')).searchParams.get('sslmode')).toBe('require');
    const custom = 'postgres://u:p@db.local:5432/crewstation?options=-c%20statement_timeout%3D5000';
    expect(withSessionDefaults(custom)).toBe(custom);
  });
});

describe.skipIf(!available)('connectDatabase 的会话默认值在真实 PostgreSQL 上生效', () => {
  test('新连接的 idle_in_transaction_session_timeout 为 1min', async () => {
    const handle = connectDatabase(process.env.CS_TEST_DATABASE_URL ?? DEFAULT_TEST_DATABASE_URL, { max: 1 });
    try {
      const rows = await handle.client`show idle_in_transaction_session_timeout` as Array<{ idle_in_transaction_session_timeout: string }>;
      expect(rows[0]?.idle_in_transaction_session_timeout).toBe('1min');
      await databaseReady(handle.db);
    } finally { await handle.close(); }
  });
});

const testUrl = () => process.env.CS_TEST_DATABASE_URL ?? DEFAULT_TEST_DATABASE_URL;
const withParams = (url: string, params: Record<string, string>) => { const parsed = new URL(url); for (const [k, v] of Object.entries(params)) parsed.searchParams.set(k, v); return parsed.toString(); };

describe.skipIf(!available)('postgres.js 连接池（RFC-023）', () => {
  test('连接池参数按裁定：上限另给，连接超时 10 秒、空闲 60 秒回收、连接寿命 30 分钟', () => {
    expect(POOL_OPTIONS).toMatchObject({ connect_timeout: 10, idle_timeout: 60, max_lifetime: 1800 });
  });

  test('连接串自带 options 时按运维给的值，不补默认', async () => {
    const handle = connectDatabase(withParams(testUrl(), { options: '-c idle_in_transaction_session_timeout=90000' }), { max: 1 });
    try {
      const rows = await handle.client`show idle_in_transaction_session_timeout` as Array<{ idle_in_transaction_session_timeout: string }>;
      expect(rows[0]?.idle_in_transaction_session_timeout).toBe('90s');
    } finally { await handle.close(); }
  });

  test('关闭后数据库里不留这个连接池的连接', async () => {
    const name = `cs-close-${crypto.randomUUID().slice(0, 8)}`;
    const handle = connectDatabase(withParams(testUrl(), { application_name: name }), { max: 3 });
    const observer = connectDatabase(testUrl(), { max: 1 });
    try {
      await Promise.all([1, 2, 3].map((i) => handle.db.execute(sql`select ${i}::int as i, pg_sleep(0.05)`)));
      const count = async () => Number((await observer.client`select count(*)::int as n from pg_stat_activity where application_name = ${name}`)[0]?.n);
      expect(await count()).toBeGreaterThan(0);
      await handle.close();
      let left = await count();
      for (let i = 0; i < 20 && left > 0; i++) { await Bun.sleep(50); left = await count(); }
      expect(left).toBe(0);
    } finally { await observer.close(); }
  });

  test('池内并发：200 个查询混着保存点事务、咨询锁、先放弃再完成的查询与 json／时间往返，每个结果都对得上自己的查询', async () => {
    const handle = connectDatabase(testUrl(), { max: 10 });
    try {
      const marker = (i: number) => `m-${i}`;
      const run = async (i: number): Promise<string> => {
        switch (i % 4) {
          case 0: return String((await handle.db.execute(sql`select ${marker(i)}::text as m, pg_sleep(0.002)`))[0]?.m);
          case 1: return handle.db.transaction(async (tx) => {
            await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`rfc023-${i % 7}`}))`);
            return tx.transaction(async (savepoint) => String((await savepoint.execute(sql`select ${marker(i)}::text as m`))[0]?.m));
          });
          case 2: {
            // 调用方等不及先放弃（如 boundedNativeRead 超时），查询仍在后台完成：它的结果不能串到别的查询上。
            const query = handle.db.execute(sql`select ${marker(i)}::text as m, pg_sleep(0.03)`);
            await Promise.race([query, Bun.sleep(1)]);
            return String((await query)[0]?.m);
          }
          default: {
            const at = new Date(Date.UTC(2026, 8, 23, 0, 0, i % 60)).toISOString();
            const row = (await handle.db.execute(sql`select ${JSON.stringify({ i })}::text::jsonb as j, ${at}::timestamptz as t`))[0] as { j: { i: number }; t: string };
            expect(new Date(row.t).toISOString()).toBe(at);
            return marker(row.j.i);
          }
        }
      };
      const results = await Promise.all(Array.from({ length: 200 }, (_, i) => run(i)));
      expect(results).toEqual(Array.from({ length: 200 }, (_, i) => marker(i)));
    } finally { await handle.close(); }
  });

  test('原生 SQL 读 int8 得到字符串：计数要转 ::int 才按数字用（全仓的原生计数都已这样写）', async () => {
    const handle = connectDatabase(testUrl(), { max: 1 });
    try {
      const [row] = await handle.db.execute(sql`select count(*) as raw, count(*)::int as n from (values (1), (2)) as v(x)`) as unknown as Array<{ raw: unknown; n: unknown }>;
      expect(row).toEqual({ raw: '2', n: 2 });
    } finally { await handle.close(); }
  });
});

