import { createHash } from 'node:crypto';
import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { MIGRATION_LOCK_FILE } from './policy';
import type { Unit } from './archModel';

export interface MigrationLock {
  readonly files: Readonly<Record<string, string>>;
}

const LOCK_NOTE = '已入锁的迁移不可修改、删除或插队；新增迁移后运行 bun run migrations:lock。规则见 docs/engineering/testing.md §7。';

/** 模块的迁移在 adapters/persistence/migrations，技术包（queue、eventbus）的在包根 migrations。 */
function migrationDirOf(unit: Unit): string | undefined {
  if (unit.kind === 'module') return join(unit.dir, 'adapters', 'persistence', 'migrations');
  return unit.kind === 'package' ? join(unit.dir, 'migrations') : undefined;
}

/**
 * 返回「相对仓库根的路径 → sha256」。哈希取法与 packages/persistence 的迁移运行器一致（对 utf8 文本取 sha256），
 * 所以锁里的值就是 platform_infra.migrations.checksum 里会出现的值。
 */
export function collectMigrationChecksums(root: string, units: readonly Unit[]): Map<string, string> {
  const out = new Map<string, string>();
  for (const unit of units) {
    const dir = migrationDirOf(unit);
    if (!dir || !existsSync(dir)) continue;
    for (const name of readdirSync(dir).filter((entry) => entry.endsWith('.sql')).sort()) {
      const path = join(dir, name);
      out.set(relative(root, path), createHash('sha256').update(readFileSync(path, 'utf8')).digest('hex'));
    }
  }
  return out;
}

export function readMigrationLock(root: string): MigrationLock {
  const path = join(root, MIGRATION_LOCK_FILE);
  if (!existsSync(path)) return { files: {} };
  const parsed = JSON.parse(readFileSync(path, 'utf8')) as Partial<MigrationLock>;
  return { files: parsed.files ?? {} };
}

export function writeMigrationLock(root: string, files: ReadonlyMap<string, string>): void {
  const sorted = Object.fromEntries([...files].sort(([a], [b]) => a.localeCompare(b)));
  writeFileSync(join(root, MIGRATION_LOCK_FILE), `${JSON.stringify({ note: LOCK_NOTE, files: sorted }, null, 2)}\n`);
}

/** 迁移序号：文件名开头的四位数字；不合命名规则的文件由 persistence-ownership 报，这里当作 0。 */
export function migrationNumber(relPath: string): number {
  return Number(/(?:^|\/)(\d{4})_[^/]*\.sql$/.exec(relPath)?.[1] ?? 0);
}

export function migrationDirKey(relPath: string): string {
  return relPath.slice(0, relPath.lastIndexOf('/'));
}
