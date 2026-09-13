import type { TaskDataBindingDto, TaskDataBindingState, TaskDataMode } from '@crewstation/contracts';
import type { RequestTaskDataBindingInput } from '@crewstation/api-client';

export interface DataAccessDraft { readonly mode: TaskDataMode; readonly reason: string; readonly ttl: string }
export function validateDataAccess(draft: DataAccessDraft): { input?: RequestTaskDataBindingInput; errors: { reason?: string; ttl?: string } } {
  const errors: { reason?: string; ttl?: string } = {};
  if (draft.reason.length > 500) errors.reason = 'devSession.data.reasonInvalid';
  const ttl = draft.ttl.trim(), value = Number(ttl);
  if (draft.mode !== 'development' && ttl !== '' && (!/^\d+$/.test(ttl) || !Number.isInteger(value) || value < 5 || value > 1440)) errors.ttl = 'devSession.data.ttlInvalid';
  return { errors, ...(Object.keys(errors).length ? {} : { input: { mode: draft.mode, ...(draft.reason.trim() ? { reason: draft.reason.trim() } : {}), ...(draft.mode !== 'development' && ttl ? { ttlMinutes: value } : {}) } }) };
}

/** 数据库角色的期限先于后台清理生效；到期记录不能继续显示为有效生产授权。 */
export function bindingDisplayState(binding: TaskDataBindingDto, now: number): TaskDataBindingState {
  return ['active', 'approved'].includes(binding.state) && binding.expiresAt && Date.parse(binding.expiresAt) <= now ? 'expired' : binding.state;
}
export function productionAccessModes(bindings: readonly TaskDataBindingDto[], now: number): TaskDataMode[] {
  return [...new Set(bindings.filter((binding) => binding.mode !== 'development' && ['active', 'approved'].includes(bindingDisplayState(binding, now))).map((binding) => binding.mode))];
}
