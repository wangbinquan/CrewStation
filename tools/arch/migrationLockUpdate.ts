import { collectMigrationChecksums, readMigrationLock, writeMigrationLock } from './migrationFiles';
import { migrationLock } from './rules/migrationLock';
import type { Violation } from './archModel';
import { loadWorkspace } from './workspace';

export interface MigrationLockUpdate {
  /** 本次追加进锁的迁移（相对仓库根）。 */
  readonly added: readonly string[];
  /** 这条命令不会替你抹平的违规：改了、删了已入锁的迁移，或新迁移序号插队。非空时锁文件不动。 */
  readonly blocking: readonly Violation[];
  readonly total: number;
}

const NOT_LOCKED = '尚未入锁';

/** 只追加：已入锁的条目永不改写。存在阻断性违规时什么都不写。 */
export function updateMigrationLock(root: string): MigrationLockUpdate {
  const ws = loadWorkspace(root);
  const locked = new Map(Object.entries(readMigrationLock(root).files));
  const blocking = migrationLock(ws).filter((violation) => !violation.message.includes(NOT_LOCKED));
  if (blocking.length > 0) return { added: [], blocking, total: locked.size };
  const added = [...collectMigrationChecksums(root, ws.units)].filter(([rel]) => !locked.has(rel));
  for (const [rel, checksum] of added) locked.set(rel, checksum);
  if (added.length > 0) writeMigrationLock(root, locked);
  return { added: added.map(([rel]) => rel), blocking: [], total: locked.size };
}
