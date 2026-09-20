// 用法：bun run migrations:lock [<迁移文件路径>…]  （只追加新迁移；已入锁的条目永不改写）
// 共享工作树上请带路径，只锁自己的迁移：不带路径会把别的会话尚未提交的新迁移一起锁进去。
import { resolve } from 'node:path';
import { updateMigrationLock } from './migrationLockUpdate';

const root = resolve(import.meta.dir, '..', '..');
const only = process.argv.slice(2);
const result = updateMigrationLock(root, only);

if (result.blocking.length > 0) {
  for (const violation of result.blocking) console.error(`✗ ${violation.file.replace(`${root}/`, '')}: ${violation.message}`);
  console.error('\n锁文件未改动。确需改写已入锁的迁移（例如发行前合并迁移）时，手工编辑锁文件并在提交说明里写清原因。');
  process.exit(1);
}
for (const rel of result.added) console.log(`＋ ${rel}`);
console.log(result.added.length > 0 ? `已入锁 ${result.added.length} 个新迁移，共 ${result.total} 个` : `没有新迁移，锁文件未改动（共 ${result.total} 个）`);
if (only.length > 0 && result.added.length < only.length) console.log('点名的路径里有的不是尚未入锁的迁移文件（写错了，或已经在锁里）。');
