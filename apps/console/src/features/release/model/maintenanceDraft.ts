import type { MaintenanceDto, MaintenanceSwitches, MaintenanceUser, SetMaintenanceRequest } from '@crewstation/contracts';
import { MAINTENANCE_LIMITS } from '@crewstation/contracts';
import type { Translate } from '../../../shared/lib/useT';

/** 维护表单的草稿；`expectedEnd` 是 datetime-local 的值（本地时间，到分钟），空串表示不填。 */
export interface MaintenanceDraft {
  readonly switches: MaintenanceSwitches;
  readonly reason: string;
  readonly expectedEnd: string;
  readonly allowUsers: readonly MaintenanceUser[];
}

export type MaintenanceField = 'reason' | 'expectedEnd' | 'allowUsers';
/** 字段 → 文案键；空对象表示可以提交。 */
export type MaintenanceDraftErrors = Partial<Record<MaintenanceField, string>>;

export const MAINTENANCE_SWITCHES = ['users', 'services', 'events'] as const;

/** 进入维护：三个开关默认全开（RFC-021 B1），原因必填，其余选填。 */
export function emptyMaintenanceDraft(): MaintenanceDraft {
  return { switches: { users: true, services: true, events: true }, reason: '', expectedEnd: '', allowUsers: [] };
}

/** 调整维护：从当前维护带出全部字段。 */
export function draftFromMaintenance(current: MaintenanceDto): MaintenanceDraft {
  return { switches: { ...current.switches }, reason: current.reason, expectedEnd: current.expectedEndAt ? toLocalInput(current.expectedEndAt) : '', allowUsers: current.allowUsers };
}

export function maintenanceDraftChanged(draft: MaintenanceDraft, base: MaintenanceDraft): boolean {
  return MAINTENANCE_SWITCHES.some((key) => draft.switches[key] !== base.switches[key]) || draft.reason !== base.reason || draft.expectedEnd !== base.expectedEnd
    || draft.allowUsers.map((user) => user.userId).join(',') !== base.allowUsers.map((user) => user.userId).join(',');
}

/** 提交前的校验与服务端同一套上限；预计恢复时间填了就必须晚于现在。 */
export function validateMaintenanceDraft(draft: MaintenanceDraft, now: Date): MaintenanceDraftErrors {
  const errors: MaintenanceDraftErrors = {}, reason = draft.reason.trim();
  if (!reason) errors.reason = 'release.maintenance.reasonRequired';
  else if (reason.length > MAINTENANCE_LIMITS.reason) errors.reason = 'release.maintenance.reasonTooLong';
  if (draft.expectedEnd) {
    const end = fromLocalInput(draft.expectedEnd);
    if (!end) errors.expectedEnd = 'release.maintenance.endInvalid';
    else if (end.getTime() <= now.getTime()) errors.expectedEnd = 'release.maintenance.endInPast';
  }
  if (draft.allowUsers.length > MAINTENANCE_LIMITS.allowUsers) errors.allowUsers = 'release.maintenance.tooManyUsers';
  return errors;
}

/** `expectedRevision`：不在维护中时为 0，调整时是表单打开时看到的版本；别人先改过时服务端 409。 */
export function maintenanceRequest(draft: MaintenanceDraft, expectedRevision: number): SetMaintenanceRequest {
  const end = draft.expectedEnd ? fromLocalInput(draft.expectedEnd) : undefined;
  return { switches: { ...draft.switches }, allowUserIds: draft.allowUsers.map((user) => user.userId), reason: draft.reason.trim(), expectedEndAt: end ? end.toISOString() : null, expectedRevision };
}

/** 「拦住：用户访问、服务域调用」；三个都关着时说明只展示说明、不拦流量。 */
export function blockingText(switches: MaintenanceSwitches, t: Translate): string {
  const on = MAINTENANCE_SWITCHES.filter((key) => switches[key]).map((key) => t(`release.maintenance.switch.${key}`));
  return on.length > 0 ? on.join(t('release.maintenance.separator')) : t('release.maintenance.blockingNone');
}

/** 三个开关都开着才是破坏性迁移的维护窗口（RFC-021 M17）。 */
export function fullMaintenanceWindow(switches: MaintenanceSwitches): boolean {
  return MAINTENANCE_SWITCHES.every((key) => switches[key]);
}

const pad = (value: number) => String(value).padStart(2, '0');

/** ISO 时间 → datetime-local 的值（本地时间，到分钟）。 */
export function toLocalInput(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '';
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

/** datetime-local 的值按本地时间解析；格式不对或解析不了返回 undefined。 */
export function fromLocalInput(value: string): Date | undefined {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2})?$/.test(value)) return undefined;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? undefined : date;
}
