import { useEffect, useId, useRef, useState } from 'react';
import type { TaskDataBindingDto } from '@crewstation/contracts';
import { useT } from '../../../../shared/lib/useT';
import { errorMessage } from '../../../../shared/api/useApi';
import { Button } from '../../../../shared/ui/Button';
import { ConfirmationDialog } from '../../../../shared/ui/dialog/ConfirmationDialog';
import { FormField } from '../../../../shared/ui/FormField';
import { ActionNote } from '../../../../shared/ui/ActionNote';
import type { DataBindingsHandle } from '../../hooks/useDataBindings';
import { bindingDisplayState } from '../../model/dataAccessForm';

type BindingAction = 'approve' | 'reject' | 'revoke';
/**
 * 负责人对一条数据访问的批准、拒绝与撤销。确认在弹窗里（2026-09-23 起）：审批意见是草稿，取消只关窗、页面上不再提示，
 * 再点批准或拒绝时恢复，「清空」清掉；提交成功才丢。
 */
export function DataBindingActions({ binding, data, onDirtyChange }: { readonly binding: TaskDataBindingDto; readonly data: DataBindingsHandle; readonly onDirtyChange: (id: string, dirty: boolean) => void }) {
  const t = useT(), id = useId(), input = useRef<HTMLTextAreaElement>(null), lock = useRef(false);
  const [action, setAction] = useState<BindingAction>(), [opinion, setOpinion] = useState(''), [error, setError] = useState<string>(), [invalid, setInvalid] = useState(false);
  useEffect(() => { onDirtyChange(binding.id, opinion !== ''); return () => onDirtyChange(binding.id, false); }, [binding.id, opinion, onDirtyChange]);
  const state = bindingDisplayState(binding, data.checkedAt), disabled = data.busy || data.isPending || !!data.loadError;
  const durationKnown = binding.mode === 'development' || binding.ttlMinutes !== undefined;
  const allowed = action === 'revoke' ? ['approved', 'active'].includes(state) : state === 'requested' && (action !== 'approve' || durationKnown);
  const submit = async () => {
    if (!action || disabled || lock.current || !data.canManage || !allowed) return;
    if (action !== 'revoke' && opinion.length > 500) { setInvalid(true); input.current?.focus(); return; }
    lock.current = true; setError(undefined);
    try {
      if (action === 'revoke') await data.revokeAccess(binding.id);
      else await data.decide(binding.id, { approve: action === 'approve', ...(opinion.trim() ? { decision: opinion.trim() } : {}) });
      if (action !== 'revoke') setOpinion(''); setAction(undefined);
    } catch (cause) { setError(errorMessage(cause)); }
    finally { lock.current = false; }
  };
  const opinionField = <FormField label={t('devSession.data.opinion')} hint={t('devSession.data.reasonHint')} hintId={`${id}-hint`} error={invalid ? t('devSession.data.reasonInvalid') : undefined} errorId={`${id}-error`}>
    <textarea ref={input} rows={2} value={opinion} disabled={disabled} aria-invalid={invalid} aria-describedby={`${id}-hint${invalid ? ` ${id}-error` : ''}`} aria-errormessage={invalid ? `${id}-error` : undefined} onChange={(event) => { setOpinion(event.target.value); setInvalid(false); }} />
  </FormField>;
  if (!data.canManage) return null;
  const begin = (next: BindingAction) => { setError(undefined); setAction(next); };
  return <>
    {state === 'requested' ? <><Button disabled={disabled || !durationKnown} onClick={() => begin('approve')}>{t('devSession.data.action.approve')}</Button><Button disabled={disabled} onClick={() => begin('reject')}>{t('devSession.data.action.reject')}</Button>{!durationKnown ? <p>{t('devSession.data.durationUnknown')}</p> : null}</> : null}
    {['approved', 'active'].includes(state) ? <Button disabled={disabled} onClick={() => begin('revoke')}>{t('devSession.data.action.revoke')}</Button> : null}
    {action ? <ConfirmationDialog question={t(`devSession.data.confirm.${action}`, { mode: t(`devSession.data.mode.${binding.mode}`), id: binding.id })} hint={t(action === 'revoke' ? binding.mode === 'development' ? 'devSession.data.revokeDevelopmentHint' : 'devSession.data.revokeHint' : 'devSession.data.approvalWarning')}
      confirmLabel={t(`devSession.data.confirmLabel.${action}`)} cancelLabel={t('devSession.release.cancel')} busy={data.busy} confirmDisabled={disabled || !allowed} onConfirm={() => void submit()} onCancel={() => setAction(undefined)}
      {...(action !== 'revoke' ? { dirty: opinion !== '', onClear: () => { setOpinion(''); setInvalid(false); } } : {})}>
      {!allowed ? <ActionNote tone="neutral">{t('devSession.data.changed')}</ActionNote> : null}
      {action !== 'revoke' ? opinionField : null}
      {error ? <ActionNote tone="error">{error}</ActionNote> : null}
    </ConfirmationDialog> : null}
  </>;
}
