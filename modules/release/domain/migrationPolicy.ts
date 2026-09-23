import type { MigrationSpec } from '@crewstation/contracts';
import type { PrecheckReason } from './precheck';
import { precheckFailed, precheckReason } from './precheck';

/** 维护窗口＝项目处于维护中且三个开关都拦（RFC-021 M14、M17）；拒绝时说清出路。 */
const WINDOW_HINT = '请负责人进入维护，并拦住用户流量、服务域调用与事件推送';

/** 迁移必须与在线槽兼容；destructive 只在维护窗口执行，且执行后禁止切回（R19、AT-14）。发布受理时与构建之后各查一次。 */
export function migrationReason(spec: MigrationSpec, maintenanceWindow: boolean): PrecheckReason | undefined {
  if (spec.destructive && !maintenanceWindow) return precheckReason('maintenance-window-required', '含破坏性迁移的版本只能在项目维护期间发布', WINDOW_HINT);
  if (spec.compatibility === 'destructive' && !spec.destructive) {
    return precheckReason('migration-undeclared', 'compatibility 为 destructive 时必须显式声明 destructive: true', '改好 crewstation.yaml 的 release.migration 后重新发布');
  }
  return undefined;
}

export function assertMigrationAllowed(spec: MigrationSpec, maintenanceWindow: boolean): void {
  const reason = migrationReason(spec, maintenanceWindow);
  if (reason) throw precheckFailed(reason, { compatibility: spec.compatibility });
}

/** 切流到含破坏性迁移的版本同样只能在维护窗口里（Design §6.5「部署与切流」，RFC-021 M27）。 */
export function assertSwitchAllowed(target: MigrationSpec | undefined, tag: string, maintenanceWindow: boolean): void {
  if (target?.destructive && !maintenanceWindow) throw precheckFailed(precheckReason('maintenance-window-required', `${tag} 含破坏性迁移，只能在项目维护期间上线`, WINDOW_HINT));
}

export function rollbackBlockedBy(spec: MigrationSpec): boolean {
  return spec.destructive || spec.rollback === 'blocked';
}
