import type { MigrationSpec } from '@crewstation/contracts';
import { precondition } from '@crewstation/kernel';

/** 迁移必须与在线槽兼容；destructive 只在维护窗口执行，且执行后禁止切回（R19、AT-14）。 */
export function assertMigrationAllowed(spec: MigrationSpec, maintenanceWindow: boolean): void {
  if (spec.destructive && !maintenanceWindow) {
    throw precondition('破坏性迁移只能在维护窗口内发布', { compatibility: spec.compatibility });
  }
  if (spec.compatibility === 'destructive' && !spec.destructive) {
    throw precondition('compatibility 为 destructive 时必须显式声明 destructive: true');
  }
}

export function rollbackBlockedBy(spec: MigrationSpec): boolean {
  return spec.destructive || spec.rollback === 'blocked';
}
