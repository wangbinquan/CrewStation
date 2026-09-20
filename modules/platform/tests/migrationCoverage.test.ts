import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { basename, resolve } from 'node:path';
import { createFakeK8sClient } from '@crewstation/k8s';
import { noopLogger } from '@crewstation/kernel';
import { runMigrations } from '@crewstation/persistence';
import { loadPlatformSettings } from '@crewstation/settings';
import type { TestDatabase } from '@crewstation/testkit';
import { createTestDatabase, testDatabaseAvailable } from '@crewstation/testkit';
import { createPlatformModule } from '../wiring';

const available = await testDatabaseAvailable();
let tdb: TestDatabase;

/** 锁文件列的是磁盘上全部迁移（tools/arch 的 migration-lock 规则保证两者一致）。 */
function lockedMigrationNames(): string[] {
  const lock = JSON.parse(readFileSync(resolve(import.meta.dir, '..', '..', '..', 'tools', 'arch', 'migrations.lock.json'), 'utf8')) as { files: Record<string, string> };
  return Object.keys(lock.files).map((path) => basename(path)).sort();
}

beforeAll(async () => {
  if (available) tdb = await createTestDatabase();
});
afterAll(async () => { await tdb?.drop(); });

describe.skipIf(!available)('平台迁移清单', () => {
  // 组合根手工列出各模块的迁移集：新模块建了迁移却忘了加进这张清单时，
  // 模块自己的用例照绿（它们各自点名迁移集），只有真实安装才发现表不存在。
  test('磁盘上的每个迁移都经平台清单、按层序在空库上一次应用成功，重跑不再应用', async () => {
    const settings = loadPlatformSettings({
      CS_DATABASE_URL: tdb.url, CS_SECRET_KEY: Buffer.alloc(32, 1).toString('base64'),
      CS_ADMIN_EMAILS: 'migrations@example.com', CS_GITLAB_URL: 'http://127.0.0.1:9',
    });
    const platform = createPlatformModule({ db: tdb.db, k8s: createFakeK8sClient(), settings, logger: noopLogger, instance: 'test.migration-coverage' });

    const applied = await runMigrations(tdb.db, platform.api.migrations);

    expect(applied.map((key) => key.slice(key.lastIndexOf('/') + 1)).sort()).toEqual(lockedMigrationNames());
    expect(await runMigrations(tdb.db, platform.api.migrations)).toEqual([]);
  }, 60_000);
});
