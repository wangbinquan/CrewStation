import type { MigrationSpec } from '@crewstation/contracts';
import { precondition } from '@crewstation/kernel';

/** 维护窗口＝项目处于维护中且三个开关都拦（RFC-021 M14、M17）；拒绝时说清出路。 */
const WINDOW_HINT = '请负责人进入维护，并拦住用户流量、服务域调用与事件推送';

/** 迁移必须与在线槽兼容；destructive 只在维护窗口执行，且执行后禁止切回（R19、AT-14）。 */
export function assertMigrationAllowed(spec: MigrationSpec, maintenanceWindow: boolean): void {
  if (spec.destructive && !maintenanceWindow) {
    throw precondition(`含破坏性迁移的版本只能在项目维护期间发布：${WINDOW_HINT}`, { compatibility: spec.compatibility });
  }
  if (spec.compatibility === 'destructive' && !spec.destructive) {
    throw precondition('compatibility 为 destructive 时必须显式声明 destructive: true');
  }
}

/** 切流到含破坏性迁移的版本同样只能在维护窗口里（Design §6.5「部署与切流」，RFC-021 M27）。 */
export function assertSwitchAllowed(target: MigrationSpec | undefined, tag: string, maintenanceWindow: boolean): void {
  if (target?.destructive && !maintenanceWindow) throw precondition(`${tag} 含破坏性迁移，只能在项目维护期间上线：${WINDOW_HINT}`);
}

export function rollbackBlockedBy(spec: MigrationSpec): boolean {
  return spec.destructive || spec.rollback === 'blocked';
}
