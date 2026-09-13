import { UserIdSchema } from '@crewstation/contracts';
import type { AlertSubscriptionDto, SetAlertSubscriptionRequest } from '@crewstation/contracts';

export interface AlertSubscriptionDraft { userId: string; channel: 'workbench' | 'webhook'; target: string }
export const emptyAlertSubscription = (): AlertSubscriptionDraft => ({ userId: '', channel: 'workbench', target: '' });
export const subscriptionDraft = (record: AlertSubscriptionDto): AlertSubscriptionDraft => ({ userId: record.userId, channel: record.channel, target: record.target ?? '' });
export const sameSubscription = (a: AlertSubscriptionDraft | undefined, b: AlertSubscriptionDraft | undefined) => a?.userId === b?.userId && a?.channel === b?.channel && (a?.target ?? '') === (b?.target ?? '');
export function validateAlertSubscription(draft: AlertSubscriptionDraft): { input?: SetAlertSubscriptionRequest; errors: { userId?: string; target?: string } } {
  const user = UserIdSchema.safeParse(draft.userId.trim()), errors: { userId?: string; target?: string } = {};
  if (!user.success) errors.userId = 'logs.alerts.subscription.userInvalid';
  if (draft.channel === 'webhook') {
    try { const url = new URL(draft.target.trim()); if (!['http:', 'https:'].includes(url.protocol) || draft.target.trim().length > 2048) errors.target = 'logs.alerts.subscription.targetInvalid'; }
    catch { errors.target = 'logs.alerts.subscription.targetInvalid'; }
  }
  return { errors, ...(user.success && !Object.keys(errors).length ? { input: { userId: user.data, channel: draft.channel, ...(draft.channel === 'webhook' ? { target: draft.target.trim() } : {}) } } : {}) };
}
