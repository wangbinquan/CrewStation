import { useRef, useState } from 'react';
import { AlertSubscriptionDtoSchema } from '@crewstation/contracts';
import type { AlertSubscriptionDto, SetAlertSubscriptionRequest } from '@crewstation/contracts';
import { api } from '../../../shared/api/client';
import { queryKeys } from '../../../shared/api/queryKeys';
import { errorMessage, useApiQuery } from '../../../shared/api/useApi';
import { useT } from '../../../shared/lib/useT';
import { emptyAlertSubscription, sameSubscription, subscriptionDraft, validateAlertSubscription } from './alertSubscriptionDraft';
import type { AlertSubscriptionDraft } from './alertSubscriptionDraft';

type Review = { kind: 'save'; input: SetAlertSubscriptionRequest; before?: AlertSubscriptionDraft } | { kind: 'remove'; before: AlertSubscriptionDraft };
export function useAlertSubscriptions(projectId: string, canManage: boolean) {
  const t = useT(), lock = useRef(false);
  const query = useApiQuery(queryKeys.alertSubscriptions(projectId), async () => {
    const response = await api.observability.alertSubscriptions(projectId);
    const parsed = AlertSubscriptionDtoSchema.array().safeParse(response.items);
    if (!parsed.success || parsed.data.some((row) => row.projectId !== projectId)) throw new Error(t('logs.alerts.mismatch')); return { items: parsed.data };
  }, { refetchIntervalMs: 5_000, refetchOnWindowFocus: true }); // 订阅每 5 秒在原位重读，不提供刷新按钮（2026-09-23 裁定）
  const members = useApiQuery(queryKeys.members(projectId), () => api.projects.listMembers(projectId));
  const [draft, setDraft] = useState(emptyAlertSubscription), [baseline, setBaseline] = useState(emptyAlertSubscription);
  const [open, setOpen] = useState(false), [editing, setEditing] = useState(false), [replacement, setReplacement] = useState<{ record?: AlertSubscriptionDto }>();
  const [review, setReview] = useState<Review>(), [busy, setBusy] = useState(false), [error, setError] = useState<string>(), [success, setSuccess] = useState<string>();
  const [errors, setErrors] = useState<{ userId?: string; target?: string }>({});
  const dirty = !sameSubscription(draft, baseline), unavailable = query.isPending || !!query.error;
  const apply = (record?: AlertSubscriptionDto) => { if (lock.current) return; const next = record ? subscriptionDraft(record) : emptyAlertSubscription(); setDraft(next); setBaseline(next); setOpen(true); setEditing(!!record); setReplacement(undefined); setReview(undefined); setErrors({}); setError(undefined); setSuccess(undefined); };
  const start = (record?: AlertSubscriptionDto) => { if (lock.current || !canManage) return; if (dirty) setReplacement({ record }); else apply(record); };
  const currentRecord = (userId: string) => query.data?.items.find((row) => row.userId === userId);
  const current = review ? currentRecord(review.kind === 'save' ? review.input.userId : review.before.userId) : undefined;
  const stale = !!review && (unavailable || !sameSubscription(current ? subscriptionDraft(current) : undefined, review.before));
  const prepare = async (record?: AlertSubscriptionDto) => {
    if (lock.current || !canManage || unavailable || replacement || review) return;
    const checked = record ? undefined : validateAlertSubscription(draft); if (checked && !checked.input) { setErrors(checked.errors); return; }
    lock.current = true; setBusy(true); setError(undefined); setSuccess(undefined); setReview(undefined);
    try {
      const result = await query.refetch(); if (result.error || !result.data) throw result.error ?? new Error(t('logs.alerts.unconfirmed'));
      const before = result.data.items.find((row) => row.userId === (record?.userId ?? checked!.input!.userId));
      if (record && (!before || !sameSubscription(subscriptionDraft(record), subscriptionDraft(before)))) throw new Error(t('logs.alerts.subscription.changed'));
      setReview(record ? { kind: 'remove', before: subscriptionDraft(before!) } : { kind: 'save', input: checked!.input!, ...(before ? { before: subscriptionDraft(before) } : {}) });
    } catch (cause) { setError(errorMessage(cause)); } finally { lock.current = false; setBusy(false); }
  };
  const confirm = async () => {
    if (lock.current || !canManage || !review || stale) return; lock.current = true; setBusy(true); setError(undefined); setSuccess(undefined);
    try {
      if (review.kind === 'save') {
        await api.observability.setAlertSubscription(projectId, review.input);
        setBaseline({ ...review.input, target: review.input.target ?? '' }); setDraft({ ...review.input, target: review.input.target ?? '' }); setOpen(false);
        setSuccess(t('logs.alerts.subscription.saved'));
      } else { await api.observability.removeAlertSubscription(projectId, review.before.userId); setSuccess(t('logs.alerts.subscription.removed')); }
    } catch (cause) { setError(errorMessage(cause)); }
    finally { setReview(undefined); await query.refetch(); lock.current = false; setBusy(false); }
  };
  return { query, members, draft, setDraft, open, editing, replacement, setReplacement, apply, review, setReview, busy, error, success, errors, setErrors, dirty, unavailable, stale, start, prepare, confirm, canManage,
    close: () => { if (!lock.current && !review) setOpen(false); }, resume: () => setOpen(true),
    name: (userId: string) => { const user = members.data?.items.find((member) => member.userId === userId); return !members.error && user ? `${user.name} · ${user.email}` : userId; } };
}
export type AlertSubscriptions = ReturnType<typeof useAlertSubscriptions>;
