import { describe, expect, test } from 'bun:test';
import { DEFAULT_TEST_DATABASE_URL, testDatabaseAvailable } from '@crewstation/testkit';
import { SESSION_OPTIONS, connectDatabase, databaseReady, withSessionDefaults } from './connection';

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
    const handle = connectDatabase(DEFAULT_TEST_DATABASE_URL, { max: 1 });
    try {
      const rows = await handle.client`show idle_in_transaction_session_timeout` as Array<{ idle_in_transaction_session_timeout: string }>;
      expect(rows[0]?.idle_in_transaction_session_timeout).toBe('1min');
      await databaseReady(handle.db);
    } finally { await handle.close(); }
  });
});
