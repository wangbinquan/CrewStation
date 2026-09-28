import { useRef, useState } from 'react';
import type { BusinessStorageLossAssessment, ConfirmFinalizationLoss } from '@crewstation/contracts';
import { ConfirmFinalizationLossSchema } from '@crewstation/contracts';
import { api } from '../../../shared/api/client';
import { AUTO_REFRESH, errorMessage, useApiMutation, useApiQuery } from '../../../shared/api/useApi';
import { useT } from '../../../shared/lib/useT';
import { Button } from '../../../shared/ui/Button';
import { FormField } from '../../../shared/ui/FormField';
import { QueryStatus } from '../../../shared/ui/QueryStatus';
import { Stack } from '../../../shared/ui/Stack';
import { DataTable } from '../../../shared/ui/DataTable';
import { ActionRow } from '../../../shared/ui/ActionRow';
import { FormDialog } from '../../../shared/ui/dialog/FormDialog';
import { ConfirmDialog } from '../../../shared/ui/dialog/ConfirmDialog';
import styles from './Storage.module.css';

export function StorageLossDialog({ taskId, open, close, accepted }: { taskId: string; open: boolean; close: () => void; accepted: () => void }) {
  const t = useT(), [reason, setReason] = useState(''), [key, setKey] = useState(() => crypto.randomUUID()), [offset, setOffset] = useState(0);
  const [confirmation, setConfirmation] = useState<{ input: ConfirmFinalizationLoss; preview: BusinessStorageLossAssessment }>(), [error, setError] = useState<string>(), sending = useRef(false);
  const query = useApiQuery(['object-storage', 'loss', taskId, offset], () => api.objectStorage.assessLoss(taskId, { offset, limit: 100 }), { ...AUTO_REFRESH, enabled: open });
  const mutation = useApiMutation((input: ConfirmFinalizationLoss) => api.objectStorage.confirmLoss(taskId, input), { invalidate: [['object-storage']], onSuccess: () => { setReason(''); setKey(crypto.randomUUID()); setConfirmation(undefined); accepted(); } });
  const preview = query.data, busy = mutation.isPending || !!confirmation;
  const prepare = () => {
    if (!preview || query.error || busy) return;
    const input = ConfirmFinalizationLossSchema.safeParse({ requestKey: key, expectedRevision: preview.revision, assessmentDigest: preview.assessmentDigest, reason, confirmation: 'accept-loss' });
    if (!input.success) { setError(t('objects.lossReasonRequired')); return; }
    setError(undefined); setConfirmation({ input: input.data, preview });
  };
  if (!open) return null;
  return <><FormDialog title={t('objects.lossTitle')} submitLabel={t('objects.lossPreview')} onSubmit={prepare} onClose={close} size="large" busy={mutation.isPending}
    error={error} submitDisabled={!preview || !!query.error || !!confirmation} onClear={() => { setReason(''); setKey(crypto.randomUUID()); setError(undefined); }} dirty={!!reason}>
    <Stack><p className={styles.warning}>{t('objects.lossHint')}</p><QueryStatus isPending={query.isPending} error={query.error} />
      {preview ? <><LossFacts value={preview} /><DataTable columns={[t('objects.name'), t('objects.finalizePath'), t('objects.state'), t('objects.references')]}>
        {preview.items.map(({ item, path, referenceCount }, i) => <tr key={`${item.name}:${i}`}><td>{item.name}</td><td className={styles.code}>{path ?? '—'}</td><td>{t(item.state === 'lost' ? 'objects.lossPending' : `objects.item.${item.state}`)}{'reason' in item ? <p>{item.reason}</p> : null}</td><td>{referenceCount ?? t('objects.unknownValue')}</td></tr>)}
      </DataTable><ActionRow><Button disabled={!offset || busy} onClick={() => setOffset(Math.max(0, offset - 100))}>{t('objects.previous')}</Button><Button disabled={preview.nextOffset === null || busy} onClick={() => setOffset(preview.nextOffset!)}>{t('objects.next')}</Button></ActionRow></> : null}
      <FormField label={t('objects.lossReason')}><textarea value={reason} maxLength={2048} disabled={busy} onChange={(e) => { setReason(e.target.value); setKey(crypto.randomUUID()); }} /></FormField>
    </Stack>
  </FormDialog>{confirmation ? <ConfirmDialog title={t('objects.lossTitle')} question={t('objects.lossConsequence')} confirmWord="discard" confirmLabel={t('objects.lossSubmit')} busy={mutation.isPending}
    confirmDisabled={!!query.error || query.data?.assessmentDigest !== confirmation.input.assessmentDigest} onCancel={() => setConfirmation(undefined)}
    onConfirm={() => { if (sending.current) return; sending.current = true; mutation.mutate(confirmation.input, { onSettled: () => { sending.current = false; } }); }}>
    <Stack><p className={styles.code}>{taskId}</p><LossFacts value={confirmation.preview} /><p>{confirmation.input.reason}</p>
      <p>{t('objects.lossStopBarrier')}</p>{query.data?.assessmentDigest !== confirmation.input.assessmentDigest ? <p role="alert">{t('objects.lossChanged')}</p> : null}
      {mutation.error ? <p role="alert">{errorMessage(mutation.error)}</p> : null}
    </Stack>
  </ConfirmDialog> : null}</>;
}
function LossFacts({ value }: { value: BusinessStorageLossAssessment }) {
  const t = useT();
  return <Stack><p>{t('objects.finalizeVolume')}: {value.volumeUid ?? t('objects.unknownValue')}</p>
    <p>{t('objects.lossCounts', { total: value.itemCount, saved: value.savedCount, lost: value.lostCount })}</p>
    <p>{t(value.resultsIncomplete ? 'objects.lossResultsIncomplete' : 'objects.lossResultsComplete')}</p>
    <p>{t(value.executionStopConfirmed ? 'objects.lossStopped' : 'objects.lossStopUnknown')}</p>
  </Stack>;
}
