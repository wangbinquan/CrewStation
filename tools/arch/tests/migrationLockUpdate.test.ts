import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { MIGRATION_LOCK_FILE } from '../policy';
import { updateMigrationLock } from '../migrationLockUpdate';

const MIGRATIONS = 'modules/orders/adapters/persistence/migrations';
let root = '';

function put(rel: string, content: string): void {
  mkdirSync(dirname(join(root, rel)), { recursive: true });
  writeFileSync(join(root, rel), content);
}
const lockText = (): string => readFileSync(join(root, MIGRATION_LOCK_FILE), 'utf8');

beforeAll(() => {
  root = mkdtempSync(join(tmpdir(), 'crewstation-migration-lock-'));
  put('package.json', JSON.stringify({ name: 'fixture', private: true, workspaces: ['modules/*', 'packages/*'] }));
  put('modules/orders/package.json', JSON.stringify({ name: '@crewstation/module-orders', crewstation: { layer: 1 } }));
  put('packages/queue/package.json', JSON.stringify({ name: '@crewstation/queue' }));
  put(`${MIGRATIONS}/0001_create_schema.sql`, 'CREATE SCHEMA orders;\n');
  put('packages/queue/migrations/0001_jobs.sql', 'CREATE TABLE platform_infra.jobs (id text);\n');
  mkdirSync(join(root, 'tools', 'arch'), { recursive: true });
});
afterAll(() => rmSync(root, { recursive: true, force: true }));

// 这些用例共用一棵临时仓库、按顺序推进：先建锁，再追加，再尝试越界。
describe('bun run migrations:lock 只追加、不改写', () => {
  test('首次运行把模块与技术包的迁移一起入锁', () => {
    const result = updateMigrationLock(root);
    expect(result.added).toEqual([`${MIGRATIONS}/0001_create_schema.sql`, 'packages/queue/migrations/0001_jobs.sql']);
    expect(Object.keys((JSON.parse(lockText()) as { files: Record<string, string> }).files)).toHaveLength(2);
  });

  test('没有新迁移时不重写锁文件', () => {
    const before = lockText();
    expect(updateMigrationLock(root)).toMatchObject({ added: [], blocking: [], total: 2 });
    expect(lockText()).toBe(before);
  });

  test('新增迁移只追加自己那一行，既有条目原样保留', () => {
    const before = JSON.parse(lockText()) as { files: Record<string, string> };
    put(`${MIGRATIONS}/0002_orders.sql`, 'CREATE TABLE orders.orders (id text);\n');
    expect(updateMigrationLock(root).added).toEqual([`${MIGRATIONS}/0002_orders.sql`]);
    const after = JSON.parse(lockText()) as { files: Record<string, string> };
    expect(after.files).toMatchObject(before.files);
    expect(Object.keys(after.files)).toHaveLength(3);
  });

  // 共享工作树上另一个会话的新迁移也躺在磁盘上。不带路径会把它一起锁进去，而自己的提交里没有那个文件，
  // CI 上就成了「已入锁的迁移被删除」。带路径时只锁点名的文件。
  test('带路径时只锁点名的迁移，别的会话的在制迁移留在锁外', () => {
    put(`${MIGRATIONS}/0003_mine.sql`, 'CREATE TABLE orders.mine (id text);\n');
    put('packages/queue/migrations/0002_someone_else.sql', 'CREATE TABLE platform_infra.theirs (id text);\n');
    expect(updateMigrationLock(root, [`./${MIGRATIONS}/0003_mine.sql`]).added).toEqual([`${MIGRATIONS}/0003_mine.sql`]);
    const files = (JSON.parse(lockText()) as { files: Record<string, string> }).files;
    expect(Object.keys(files)).toContain(`${MIGRATIONS}/0003_mine.sql`);
    expect(Object.keys(files)).not.toContain('packages/queue/migrations/0002_someone_else.sql');
    rmSync(join(root, 'packages/queue/migrations/0002_someone_else.sql'));
  });

  // 这条命令最容易被当成「让门禁变绿的按钮」：改了旧迁移再跑一遍锁。它必须拒绝，而且一个字节都不写。
  test('已入锁的迁移被改过：拒绝，锁文件不动，同批的新迁移也不入锁', () => {
    const before = lockText();
    put(`${MIGRATIONS}/0001_create_schema.sql`, 'CREATE SCHEMA orders;\nCREATE TABLE orders.sneaked (id text);\n');
    put(`${MIGRATIONS}/0004_more.sql`, 'CREATE TABLE orders.more (id text);\n');
    const result = updateMigrationLock(root);
    expect(result.added).toEqual([]);
    expect(result.blocking.map((violation) => violation.message).join()).toContain('不可修改');
    expect(lockText()).toBe(before);
  });

  test('改回原样后，插队的序号同样被拒绝', () => {
    put(`${MIGRATIONS}/0001_create_schema.sql`, 'CREATE SCHEMA orders;\n');
    rmSync(join(root, `${MIGRATIONS}/0004_more.sql`));
    put(`${MIGRATIONS}/0002_earlier.sql`, 'CREATE TABLE orders.earlier (id text);\n');
    const result = updateMigrationLock(root);
    expect(result.added).toEqual([]);
    expect(result.blocking.map((violation) => violation.message).join()).toContain('必须大于同目录已入锁的最大序号 0003');
  });
});
