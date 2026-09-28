import type { BusinessTaskStorageDetail } from '@crewstation/contracts';
import { useState } from 'react';
import { api } from '../../../shared/api/client';
import { AUTO_REFRESH, useApiQuery } from '../../../shared/api/useApi';
import { useT } from '../../../shared/lib/useT';
import { Card } from '../../../shared/ui/Card';
import { QueryStatus } from '../../../shared/ui/QueryStatus';
import { Stack } from '../../../shared/ui/Stack';
import { ButtonLink } from '../../../shared/ui/navigation/ButtonLink';
import { storageTime } from '../model/storageValues';
import styles from './Storage.module.css';
import { ReceiptItems } from './ReceiptItems';
import { Button } from '../../../shared/ui/Button';
import { StorageFinalizeDialog } from './StorageFinalizeDialog';
import { StorageLossDialog } from './StorageLossDialog';
import { StorageRevisionDialog } from './StorageRevisionDialog';

export function TaskStorageStatus({ taskId, operationId }: { taskId: string; operationId?: string }) {
  const t = useT();
  const query = useApiQuery(['object-storage', 'task', taskId], () => api.objectStorage.task(taskId), AUTO_REFRESH);
  const changed = operationId && query.data?.finalization && query.data.finalization.operationId !== operationId;
  return <><QueryStatus isPending={query.isPending} error={query.error} />{changed ? <p role="alert">{t('objects.receiptChanged')}</p> : query.data ? <StorageProgress key={query.data.taskId} value={query.data} /> : null}</>;
}
function StorageProgress({ value }: { value: BusinessTaskStorageDetail }) {
  const t = useT(), progress = value.finalization, receipt = progress?.receipt, [finalizing, setFinalizing] = useState(false);
  const [losing, setLosing] = useState(false), [lossAccepted, setLossAccepted] = useState(false);
  const [revising, setRevising] = useState(false);
  const lossEligible = value.canOperateStorage && progress && !receipt && ['requested', 'draining', 'archiving'].includes(progress.phase) && progress.phaseState !== 'revising';
  const known = (v: boolean | null) => t(v === true ? 'objects.confirmed' : v === null ? 'objects.unknownValue' : 'objects.notConfirmed');
  const facts = (rows: [string, string | number][]) => <dl className={styles.stats}>{rows.map(([key, text]) => <div key={key}><dt>{t(`objects.${key}`)}</dt><dd>{text}</dd></div>)}</dl>;
  return <><Stack>
    <Card title={t('objects.taskProgress')} stacked>
      <p>{t(value.completionPolicy === 'legacy' ? 'objects.legacyPolicy' : 'objects.archivePolicy')}</p>
      {progress ? <>{facts([
        ['outcome', t(`objects.outcome.${progress.outcome}`)], ['phase', t(progress.phase === 'completed' && receipt?.disposition === 'loss' ? 'objects.completedWithLoss' : `objects.phase.${progress.phase}`)], ['phaseState', t(progress.phase === 'completed' ? receipt?.disposition === 'loss' ? 'objects.completedWithLoss' : 'objects.phase.completed' : `objects.phaseState.${progress.phaseState}`)],
        ['computeStopped', known(progress.computeStopped)], ['artifactsReady', known(progress.artifactsReady)],
        ['volumeDisposition', t(`objects.volume.${progress.volumeDisposition}`)], ['storageReclaimed', known(progress.storageReclaimed)],
        ['nextRetry', storageTime(progress.nextRetryAt)], ['stateUpdated', storageTime(progress.updatedAt)],
      ])}{progress.message ? <p role="status">{progress.message} {progress.errorCode ? `(${progress.errorCode})` : ''}</p> : null}</> : <p>{t('objects.noFinalization')}</p>}
    </Card>
    {receipt ? <Card title={t('objects.receipt')} stacked>{facts([
      ['receiptId', receipt.id], ['disposition', t(`objects.receipt.${receipt.disposition}`)], ['itemCount', receipt.itemCount], ['digest', receipt.manifestDigest], ['created', storageTime(receipt.createdAt)],
    ])}{receipt.noArtifactsReason ? <p>{receipt.noArtifactsReason}</p> : null}{receipt.lossReason ? <p className={styles.warning}>{receipt.lossReason}</p> : null}</Card> : null}
    {receipt ? <ReceiptItems key={receipt.id} receipt={receipt} canDelete={value.canOperateStorage && progress?.phase === 'completed'} /> : null}
    <ButtonLink to="/projects/$projectId/operations" params={{ projectId: value.projectId }} search={{ tab: 'topology' }}>{t('objects.topology')}</ButtonLink>
    {value.canOperateStorage && value.completionPolicy === 'archive-and-delete' && !progress ? <Button onClick={() => setFinalizing(true)}>{t('objects.finalizeTitle')}</Button> : null}
    {lossEligible && !lossAccepted ? <Button variant="danger" onClick={() => setLosing(true)}>{t('objects.lossTitle')}</Button> : null}
    {lossEligible && !lossAccepted ? <Button onClick={() => setRevising(true)}>{t('objects.revisionTitle')}</Button> : null}
    {lossAccepted && !receipt ? <p role="status">{t('objects.lossAccepted')}</p> : null}
  </Stack>{value.canOperateStorage && value.completionPolicy === 'archive-and-delete' && !progress ? <StorageFinalizeDialog key={`finalize:${value.taskId}`} taskId={value.taskId} open={finalizing} close={() => setFinalizing(false)} /> : null}
    {lossEligible ? <><StorageLossDialog key={`loss:${value.taskId}`} taskId={value.taskId} open={losing} close={() => setLosing(false)} accepted={() => { setLossAccepted(true); setLosing(false); }} />
      <StorageRevisionDialog key={`revision:${value.taskId}`} taskId={value.taskId} open={revising} close={() => setRevising(false)} /></> : null}</>;
}
