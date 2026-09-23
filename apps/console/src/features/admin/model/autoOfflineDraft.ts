import type { AutoOfflinePolicyDto, SetAutoOfflinePolicyRequest } from '@crewstation/contracts';

export const AUTO_OFFLINE_FIELDS = ['rollbackRetentionHours', 'idleOfflineDays', 'reminderLeadHours'] as const;
export type AutoOfflineField = (typeof AUTO_OFFLINE_FIELDS)[number];

/** 表单里三个时长都是字符串，提交前才窄化成整数。 */
export type AutoOfflineDraft = Readonly<Record<AutoOfflineField, string>>;
/** 字段 → 文案键。 */
export type AutoOfflineErrors = Partial<Record<AutoOfflineField, string>>;

/** 与服务端契约同一组上限（RFC-021 M11、M12、M22）。 */
const LIMITS: Readonly<Record<AutoOfflineField, { readonly min: number; readonly max: number }>> = {
  rollbackRetentionHours: { min: 1, max: 8760 },
  idleOfflineDays: { min: 1, max: 365 },
  reminderLeadHours: { min: 1, max: 720 },
};

export function autoOfflineDraft(policy: AutoOfflinePolicyDto): AutoOfflineDraft {
  return { rollbackRetentionHours: String(policy.rollbackRetentionHours), idleOfflineDays: String(policy.idleOfflineDays), reminderLeadHours: String(policy.reminderLeadHours) };
}

function wholeNumber(text: string, field: AutoOfflineField): number | undefined {
  const trimmed = text.trim(), value = Number(trimmed), limit = LIMITS[field];
  return /^\d+$/.test(trimmed) && value >= limit.min && value <= limit.max ? value : undefined;
}

/**
 * 提交前的校验与服务端一致：正整数且在各自范围内；提前提醒的时间必须短于回退保留期、也短于无人访问期限，
 * 否则还没来得及提醒就到期了。通过时给出请求体，带上开始修改时读到的版本号。
 */
export function validateAutoOffline(draft: AutoOfflineDraft, expectedRevision: number): { readonly errors: AutoOfflineErrors; readonly request?: SetAutoOfflinePolicyRequest } {
  const errors: AutoOfflineErrors = {};
  const rollback = wholeNumber(draft.rollbackRetentionHours, 'rollbackRetentionHours'), idle = wholeNumber(draft.idleOfflineDays, 'idleOfflineDays'), lead = wholeNumber(draft.reminderLeadHours, 'reminderLeadHours');
  if (rollback === undefined) errors.rollbackRetentionHours = 'admin.settings.autoOffline.range.rollbackRetentionHours';
  if (idle === undefined) errors.idleOfflineDays = 'admin.settings.autoOffline.range.idleOfflineDays';
  if (lead === undefined) errors.reminderLeadHours = 'admin.settings.autoOffline.range.reminderLeadHours';
  else if (rollback !== undefined && lead >= rollback) errors.reminderLeadHours = 'admin.settings.autoOffline.leadVsRollback';
  else if (idle !== undefined && lead >= idle * 24) errors.reminderLeadHours = 'admin.settings.autoOffline.leadVsIdle';
  if (rollback === undefined || idle === undefined || lead === undefined || Object.keys(errors).length > 0) return { errors };
  return { errors, request: { rollbackRetentionHours: rollback, idleOfflineDays: idle, reminderLeadHours: lead, expectedRevision } };
}
