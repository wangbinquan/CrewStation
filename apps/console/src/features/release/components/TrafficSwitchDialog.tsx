import { useEffect, useId, useRef } from 'react';
import type { ReactElement } from 'react';
import { useDateText } from '../../../shared/lib/useDateText';
import { useT } from '../../../shared/lib/useT';
import { ActionNote } from '../../../shared/ui/ActionNote';
import { Button } from '../../../shared/ui/Button';
import { DefinitionList } from '../../../shared/ui/DefinitionList';
import { FormField } from '../../../shared/ui/FormField';
import { ConfirmationDialog } from '../../../shared/ui/dialog/ConfirmationDialog';
import type { TrafficSnapshot } from '../model/deployedVersions';
import type { useTrafficConfirmation } from '../model/useTrafficConfirmation';

interface TrafficSwitchDialogProps {
  readonly traffic: ReturnType<typeof useTrafficConfirmation>;
  readonly snapshot: TrafficSnapshot;
  /** 核对之后部署变了或读不到：确认键不可用，要重新核对。 */
  readonly stale: boolean;
  /** 不能重新核对：页上另有写操作、有发布在进行、待命槽没有可切的版本。 */
  readonly recheckBlocked: boolean;
  /** 不能确认：页上另有写操作或没有切流权限。 */
  readonly confirmBlocked: boolean;
}

/**
 * 上线／回退的确认弹窗（RFC-020 §6，2026-09-23 起由页内面板改为弹窗）：写清两个版本的提交、核对时间与切换说明。
 * 切换说明是草稿：取消只关窗，下次核对打开时恢复；失败时弹窗关掉、原因与恢复说明留在页面上。
 */
export function TrafficSwitchDialog({ traffic: p, snapshot, stale, recheckBlocked, confirmBlocked }: TrafficSwitchDialogProps): ReactElement {
  const t = useT(), date = useDateText(), id = useId(), reasonInput = useRef<HTMLTextAreaElement>(null);
  useEffect(() => { if (p.fieldError) reasonInput.current?.focus(); }, [p.fieldError]);
  const tag = snapshot.target.tag;
  return <ConfirmationDialog size="medium" title={t(snapshot.rollback ? 'release.traffic.rollbackAction' : 'release.traffic.goLiveAction', { tag })}
    question={t('release.traffic.question', { from: snapshot.prod?.tag ?? t('release.versions.empty'), to: tag })} hint={t(snapshot.rollback ? 'release.traffic.rollbackHint' : 'release.traffic.goLiveHint')}
    confirmLabel={t(snapshot.rollback ? 'release.traffic.rollback' : 'release.traffic.goLive', { tag })} cancelLabel={t('release.traffic.cancel')} busy={p.busy}
    confirmDisabled={stale || confirmBlocked} onConfirm={() => void p.confirm(stale)} onCancel={p.cancel}
    actions={<Button disabled={recheckBlocked || p.checking || p.busy} onClick={() => void p.check(true)}>{t(p.checking ? 'release.traffic.checking' : 'release.traffic.recheck')}</Button>}
    dirty={p.reason !== ''} onClear={() => { p.setReason(''); p.setFieldError(undefined); }}>
    <DefinitionList items={[{ label: t('release.versions.prod'), value: <code>{snapshot.prod?.commitSha ?? t('release.versions.empty')}</code> }, { label: t('release.traffic.target'), value: <code>{snapshot.target.commitSha}</code> }, { label: t('release.prepare.checkedAt'), value: date(snapshot.checkedAt) }]} />
    {stale ? <ActionNote tone="error">{t('release.traffic.stale')}</ActionNote> : null}
    {p.error ? <ActionNote tone="error">{p.error}</ActionNote> : null}
    <FormField label={t('release.traffic.reason')} hint={t('release.traffic.reasonHint')} hintId={`${id}-hint`} error={p.fieldError} errorId={`${id}-error`}>
      <textarea ref={reasonInput} name="trafficReason" rows={2} value={p.reason} disabled={p.busy} aria-invalid={!!p.fieldError} aria-describedby={`${id}-hint${p.fieldError ? ` ${id}-error` : ''}`} aria-errormessage={p.fieldError ? `${id}-error` : undefined} onChange={(event) => { p.setReason(event.target.value); p.setFieldError(undefined); }} />
    </FormField>
  </ConfirmationDialog>;
}
