import type { DevSessionDto } from '@crewstation/contracts';
import { useEffect, useId, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { errorMessage } from '../../../shared/api/useApi';
import { useT } from '../../../shared/lib/useT';
import { Button } from '../../../shared/ui/Button';
import { ActionRow } from '../../../shared/ui/ActionRow';
import { Stack } from '../../../shared/ui/Stack';
import { Card } from '../../../shared/ui/Card';
import { ConfirmationPanel } from '../../../shared/ui/ConfirmationPanel';
import { DefinitionList } from '../../../shared/ui/DefinitionList';
import { FormField } from '../../../shared/ui/FormField';
import { useSessionRebuild } from '../hooks/useSessionRebuild';
import { PaneNotice } from './PaneNotice';

/** 恢复原工作树为主入口；另建远端工作树保持显式、独立确认。 */
export function RebuildSessionControl({ projectId, session, newSession }: { projectId: string; session: DevSessionDto; newSession: ReactNode }) {
  const t = useT();
  const recovery = useSessionRebuild(projectId, session.taskId);
  const [showNew, setShowNew] = useState(false);
  const panel = useRef<HTMLDivElement>(null);
  const startId = useId();
  const wasOpen = useRef(false);
  useEffect(() => {
    if (recovery.inspection) panel.current?.querySelector('select')?.focus();
    else if (wasOpen.current) document.getElementById(startId)?.focus();
    wasOpen.current = Boolean(recovery.inspection);
  }, [recovery.inspection, startId]);
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
  return <Card stacked compact title={t('devSession.rebuild.title')}>
    {receipt?.state === 'failed' ? <PaneNotice tone="warning">{receipt.message}</PaneNotice> : null}
    {!inspection ? <>
      <ActionRow>
        <Button id={startId} variant="primary" disabled={recovery.check.isPending} onClick={() => { setShowNew(false); recovery.inspect(); }}>{t(recovery.check.isPending ? 'devSession.rebuild.checking' : 'devSession.rebuild.check')}</Button>
        {session.state === 'failed' ? <Button variant="ghost" disabled={recovery.check.isPending} onClick={() => setShowNew(!showNew)} aria-expanded={showNew}>{t('devSession.rebuild.newRemote')}</Button> : null}
      </ActionRow>
      {showNew ? newSession : null}
    </> : <Stack ref={panel}>
      <DefinitionList layout="grid" items={[{ label: t('devSession.session.taskId'), value: inspection.taskId },
        { label: t('devSession.rebuild.volume'), value: `${inspection.volume.capacity} · ${inspection.volume.uid}` }]} />
      <FormField label={t('devSession.rebuild.profile')} hint={t('devSession.rebuild.profileHint', { capacity: inspection.volume.capacity })}>
        <select aria-label={t('devSession.rebuild.profile')} value={recovery.profileName} disabled={Boolean(recovery.submitted)} onChange={(event) => recovery.setProfileName(event.target.value)}>
          <option value="">{t('devSession.rebuild.pick')}</option>
          {inspection.profiles.map((profile) => <option key={profile.name} value={profile.name}>{t('devSession.rebuild.profileOption', { name: profile.name, cpu: profile.cpu, memory: profile.memory, storage: profile.storage })}</option>)}
        </select>
      </FormField>
      {inspection.profiles.length === 0 ? <PaneNotice tone="warning">{t('devSession.rebuild.noProfiles')}</PaneNotice> : null}
      {!recovery.submitted ? <ConfirmationPanel question={t('devSession.rebuild.question')} hint={t(inspection.reason === 'protocol_mismatch' ? 'devSession.rebuild.upgradeHint' : 'devSession.rebuild.hint')}
        confirmLabel={t('devSession.rebuild.confirm')} cancelLabel={t('devSession.failed.cancel')} confirmDisabled={!recovery.profile}
        onConfirm={() => void recovery.confirm()} onCancel={recovery.cancel} />
        : <>
          {!confirmedFailure ? <PaneNotice tone={recovery.submit.error ? 'warning' : 'info'}>{t(recovery.submit.isPending ? 'devSession.rebuild.sending' : 'devSession.rebuild.receiptUnknown')}</PaneNotice> : null}
          <Button disabled={recovery.submit.isPending} onClick={needsCheck ? recovery.inspect : () => void recovery.confirm()}>{t(needsCheck ? 'devSession.rebuild.recheck' : 'devSession.rebuild.retry')}</Button>
        </>}
    </Stack>}
    {recovery.check.error ? <PaneNotice tone="warning">{errorMessage(recovery.check.error)}</PaneNotice> : null}
    {recovery.submit.error ? <PaneNotice tone="warning">{errorMessage(recovery.submit.error)}</PaneNotice> : null}
  </Card>;
}
