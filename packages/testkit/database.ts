import { SQL } from 'bun';
import type { Database, DatabaseHandle, MigrationSet } from '@crewstation/persistence';
import { connectDatabase, runMigrations, withDatabaseName } from '@crewstation/persistence';

/** 本机默认指向 deploy/local 说明里的一次性容器；CI 通过 CS_TEST_DATABASE_URL 指定。 */
export const DEFAULT_TEST_DATABASE_URL = 'postgres://crewstation:crewstation-dev@127.0.0.1:55432/crewstation';

export interface TestDatabase {
  readonly url: string;
  readonly db: Database;
  readonly handle: DatabaseHandle;
  drop(): Promise<void>;
}

let availability: Promise<boolean> | undefined;

/** 数据库不可达时返回 false，调用方应 skip 并在日志里说明，而不是静默通过。 */
export function testDatabaseAvailable(): Promise<boolean> {
  availability ??= (async () => {
    const admin = new SQL(baseUrl(), { max: 1 });
    try {
      await admin`SELECT 1`;
      return true;
    } catch (error) {
      console.warn(`[testkit] 测试数据库不可达，相关测试将跳过：${baseUrl()}（${String(error)}）`);
      return false;
    } finally {
      await admin.close();
    }
  })();
  return availability;
}

/** 每次调用新建一个独立数据库并执行给定迁移；用完 drop()。 */
export async function createTestDatabase(migrations: MigrationSet[] = []): Promise<TestDatabase> {
  const name = `cs_test_${Bun.randomUUIDv7().replace(/-/g, '').slice(0, 20)}`;
  const admin = new SQL(baseUrl(), { max: 1 });
  await admin.unsafe(`CREATE DATABASE ${name}`);
  const url = withDatabaseName(baseUrl(), name);
  const handle = connectDatabase(url, { max: 4 });
  await runMigrations(handle.db, migrations);
  return {
    url,
    db: handle.db,
    handle,
    drop: async () => {
      await handle.close();
      await admin.unsafe(`DROP DATABASE IF EXISTS ${name} WITH (FORCE)`);
      await admin.close();
    },
  };
}

function baseUrl(): string {
  return process.env.CS_TEST_DATABASE_URL ?? DEFAULT_TEST_DATABASE_URL;
}
