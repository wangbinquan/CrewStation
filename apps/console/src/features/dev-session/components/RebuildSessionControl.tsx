import type { DevSessionDto } from '@crewstation/contracts';
import { useEffect, useId, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { errorMessage } from '../../../shared/api/useApi';
import { useT } from '../../../shared/lib/useT';
import { Button } from '../../../shared/ui/Button';
import { ActionRow } from '../../../shared/ui/ActionRow';
import { Card } from '../../../shared/ui/Card';
import { DefinitionList } from '../../../shared/ui/DefinitionList';
import { FormField } from '../../../shared/ui/FormField';
import { ConfirmationDialog } from '../../../shared/ui/dialog/ConfirmationDialog';
import { Dialog } from '../../../shared/ui/dialog/Dialog';
import { useSessionRebuild } from '../hooks/useSessionRebuild';
import { PaneNotice } from './PaneNotice';

/**
 * 恢复原工作树为主入口；另建远端工作树保持显式、独立确认。2026-09-23 起两者都在弹窗里：核对结果（任务、工作卷、资源套餐）
 * 与确认在一个确认弹窗里，取消只关窗、选过的套餐下次核对仍在（「清空」回到当前套餐）；确认后弹窗关闭，回执与重试留在卡片上。
 */
export function RebuildSessionControl({ projectId, session, newSession }: { projectId: string; session: DevSessionDto; newSession: ReactNode }) {
  const t = useT();
  const recovery = useSessionRebuild(projectId, session.taskId);
  const [showNew, setShowNew] = useState(false);
  const select = useRef<HTMLSelectElement>(null), startId = useId(), wasOpen = useRef(false);
  const confirming = Boolean(recovery.inspection) && !recovery.submitted;
  // 弹窗打开时焦点落在资源套餐上；取消后回到「检查并恢复」。
  useEffect(() => {
    if (confirming) select.current?.focus();
    else if (wasOpen.current && !recovery.submitted) document.getElementById(startId)?.focus();
    wasOpen.current = confirming;
  }, [confirming, recovery.submitted, startId]);
  const receipt = session.rebuild?.requestId === recovery.submitted?.requestId ? session.rebuild : recovery.submit.data ?? session.rebuild;
  // 恢复成功后的状态留在工作区工具栏，避免长期占据一整行通知。
  const upgrade = session.connectionIssue?.code === 'protocol_mismatch';
  if (session.state === 'running' && receipt?.state === 'ready' && !upgrade) return null;
  if ((session.state !== 'failed' && !upgrade) || receipt && ['queued', 'replacing', 'starting'].includes(receipt.state)) {
    return receipt ? <PaneNotice tone={receipt.state === 'failed' ? 'warning' : 'info'}>{t(`devSession.rebuild.${receipt.state}`)} · {receipt.message}</PaneNotice> : null;
  }
  const inspection = recovery.inspection;
  const confirmedFailure = receipt?.requestId === recovery.submitted?.requestId && receipt?.state === 'failed';
  const needsCheck = confirmedFailure || (recovery.submit.error && ['conflict', 'precondition', 'not_found'].includes(recovery.submit.error.kind));
  const facts = inspection ? <DefinitionList layout="grid" items={[{ label: t('devSession.session.taskId'), value: inspection.taskId },
    { label: t('devSession.rebuild.volume'), value: `${inspection.volume.capacity} · ${inspection.volume.uid}` },
    ...(recovery.submitted ? [{ label: t('devSession.rebuild.profile'), value: recovery.submitted.profile.name }] : [])]} /> : null;
  return <Card stacked compact title={t('devSession.rebuild.title')}>
    {receipt?.state === 'failed' ? <PaneNotice tone="warning">{receipt.message}</PaneNotice> : null}
    {!recovery.submitted ? <ActionRow>
      <Button id={startId} variant="primary" disabled={recovery.check.isPending} onClick={() => recovery.inspect()}>{t(recovery.check.isPending ? 'devSession.rebuild.checking' : 'devSession.rebuild.check')}</Button>
      {session.state === 'failed' ? <Button disabled={recovery.check.isPending} onClick={() => setShowNew(true)}>{t('devSession.rebuild.newRemote')}</Button> : null}
    </ActionRow> : <>
      {facts}
      {!confirmedFailure ? <PaneNotice tone={recovery.submit.error ? 'warning' : 'info'}>{t(recovery.submit.isPending ? 'devSession.rebuild.sending' : 'devSession.rebuild.receiptUnknown')}</PaneNotice> : null}
      <ActionRow><Button disabled={recovery.submit.isPending} onClick={needsCheck ? recovery.inspect : () => void recovery.confirm()}>{t(needsCheck ? 'devSession.rebuild.recheck' : 'devSession.rebuild.retry')}</Button></ActionRow>
    </>}
    {confirming && inspection ? <ConfirmationDialog size="medium" title={t('devSession.rebuild.title')} question={t('devSession.rebuild.question')} hint={t(inspection.reason === 'protocol_mismatch' ? 'devSession.rebuild.upgradeHint' : 'devSession.rebuild.hint')}
      confirmLabel={t('devSession.rebuild.confirm')} cancelLabel={t('devSession.failed.cancel')} confirmDisabled={!recovery.profile}
      dirty={recovery.profileChanged} onClear={recovery.resetProfile} onConfirm={() => void recovery.confirm()} onCancel={recovery.cancel}>
      {facts}
      <FormField label={t('devSession.rebuild.profile')} hint={t('devSession.rebuild.profileHint', { capacity: inspection.volume.capacity })}>
        <select ref={select} aria-label={t('devSession.rebuild.profile')} value={recovery.profileName} onChange={(event) => recovery.setProfileName(event.target.value)}>
          <option value="">{t('devSession.rebuild.pick')}</option>
          {inspection.profiles.map((profile) => <option key={profile.id} value={profile.id}>{t('devSession.rebuild.profileOption', { name: profile.name, cpu: profile.cpu, memory: profile.memory, storage: profile.storage })}</option>)}
        </select>
      </FormField>
      {inspection.profiles.length === 0 ? <PaneNotice tone="warning">{t('devSession.rebuild.noProfiles')}</PaneNotice> : null}
    </ConfirmationDialog> : null}
    {showNew ? <Dialog title={t('devSession.rebuild.newRemote')} onClose={() => setShowNew(false)}>{newSession}</Dialog> : null}
    {recovery.check.error ? <PaneNotice tone="warning">{errorMessage(recovery.check.error)}</PaneNotice> : null}
    {recovery.submit.error ? <PaneNotice tone="warning">{errorMessage(recovery.submit.error)}</PaneNotice> : null}
  </Card>;
}
