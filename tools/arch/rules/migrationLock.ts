import { join } from 'node:path';
import { collectMigrationChecksums, migrationDirKey, migrationNumber, readMigrationLock } from '../migrationFiles';
import type { Violation, Workspace } from '../archModel';

const RULE = 'migration-lock';

/**
 * 迁移只增不改。运行器只在**已应用过**的库上才发现文件被改（校验和不符），而 CI 的库每次都是空的，
 * 所以改旧迁移在 CI 永远是绿的、到真实升级才炸。锁文件把这件事提前到门禁。
 */
export function migrationLock(ws: Workspace): Violation[] {
  const locked = readMigrationLock(ws.root).files;
  const current = collectMigrationChecksums(ws.root, ws.units);
  const out: Violation[] = [];
  for (const [rel, checksum] of current) {
    const expected = locked[rel];
    if (expected === undefined) out.push(...checkNewMigration(ws.root, rel, locked));
    else if (expected !== checksum) out.push({ rule: RULE, file: join(ws.root, rel), message: '已入锁的迁移不可修改：已应用过它的环境会在升级时拒绝；要改就新增一个迁移' });
  }
  for (const rel of Object.keys(locked)) {
    if (!current.has(rel)) out.push({ rule: RULE, file: join(ws.root, rel), message: '已入锁的迁移被删除或改名：已应用过它的环境无从对账；恢复原文件' });
  }
  return out;
}

function checkNewMigration(root: string, rel: string, locked: Readonly<Record<string, string>>): Violation[] {
  const dir = migrationDirKey(rel);
  const highest = Math.max(0, ...Object.keys(locked).filter((other) => migrationDirKey(other) === dir).map(migrationNumber));
  if (migrationNumber(rel) <= highest) {
    return [{ rule: RULE, file: join(root, rel), message: `新迁移的序号必须大于同目录已入锁的最大序号 ${String(highest).padStart(4, '0')}：插队会让新装与升级的执行顺序不一致` }];
  }
  return [{ rule: RULE, file: join(root, rel), message: '新迁移尚未入锁：运行 bun run migrations:lock 并把锁文件一起提交' }];
}
