import { useRef, useState } from 'react';
import type { AdministrativeFinalization, BusinessStoragePreview, FinalizationArchive, OperatorArchivePlan } from '@crewstation/contracts';
import { AdministrativeFinalizationSchema, OperatorArchivePlanSchema } from '@crewstation/contracts';
import { api } from '../../../shared/api/client';
import { errorMessage, useApiMutation } from '../../../shared/api/useApi';
import { useT } from '../../../shared/lib/useT';
import { Button } from '../../../shared/ui/Button';
import { FormField } from '../../../shared/ui/FormField';
import { Stack } from '../../../shared/ui/Stack';
import { FormDialog } from '../../../shared/ui/dialog/FormDialog';
import { ConfirmDialog } from '../../../shared/ui/dialog/ConfirmDialog';
import styles from './Storage.module.css';

interface Draft { mode: '' | 'files' | 'empty'; outcome: AdministrativeFinalization['outcome'] | ''; reason: string; emptyReason: string; requestKey: string; entries: OperatorArchivePlan['entries'] }
interface Confirmation { input: AdministrativeFinalization; preview: BusinessStoragePreview; paths: string[] }
const initial = (): Draft => ({ mode: '', outcome: '', reason: '', emptyReason: '', requestKey: crypto.randomUUID(), entries: [{ kind: 'file', path: '', name: '', required: true }] });

export function StorageFinalizeDialog({ taskId, open, close }: { taskId: string; open: boolean; close: () => void }) {
  const t = useT(), [draft, setDraft] = useState(initial), [confirmation, setConfirmation] = useState<Confirmation>(), [error, setError] = useState<string>();
  const sending = useRef(false);
  const change = (patch: Partial<Draft>) => setDraft((old) => ({ ...old, ...patch, requestKey: crypto.randomUUID() }));
  const finish = useApiMutation((input: AdministrativeFinalization) => api.objectStorage.finalize(taskId, input), { invalidate: [['object-storage'], ['business-execution-tasks']], onSuccess: () => { setDraft(initial()); setConfirmation(undefined); close(); } });
  const prepare = useApiMutation(async (input: Draft) => {
    const preview = await api.objectStorage.finalizationPreview(taskId);
    if (preview.finalization) throw new Error(t('objects.finalizeAlreadyStarted'));
    let archive: FinalizationArchive;
    if (input.mode === 'empty') archive = { noArtifactsReason: input.emptyReason };
    else {
      const plan = await api.objectStorage.prepareArchive(taskId, OperatorArchivePlanSchema.parse({ requestKey: input.requestKey, reason: input.reason, entries: input.entries }));
      archive = { planId: plan.id, planRevision: plan.revision, digest: plan.digest! };
    }
    return { preview, paths: input.mode === 'files' ? input.entries.map((e) => e.kind === 'file' ? e.path : e.objectId) : [],
      input: AdministrativeFinalizationSchema.parse({ requestKey: input.requestKey, expectedGeneration: preview.task.generation, outcome: input.outcome, reason: input.reason, archive, confirmation: 'finalize' }) };
  }, { onSuccess: setConfirmation });
  const busy = prepare.isPending || finish.isPending || !!confirmation;
  const submit = () => {
    setError(undefined);
    if (busy || sending.current) return;
    if (!draft.mode || !draft.outcome || !draft.reason.trim() || draft.mode === 'empty' && !draft.emptyReason.trim()) { setError(t('objects.finalizeFormRequired')); return; }
    if (draft.mode === 'files' && !OperatorArchivePlanSchema.safeParse({ requestKey: draft.requestKey, reason: draft.reason, entries: draft.entries }).success) { setError(t('objects.invalidForm')); return; }
    sending.current = true; prepare.mutate(draft, { onSettled: () => { sending.current = false; } });
  };
  if (!open) return null;
  return <><FormDialog title={t('objects.finalizeTitle')} submitLabel={t('objects.finalizePreview')} busy={prepare.isPending || finish.isPending} submitDisabled={!!confirmation} onSubmit={submit} onClose={close} size="large"
    onClear={() => { setDraft(initial()); setError(undefined); prepare.reset(); }} dirty={!!draft.mode || !!draft.outcome || !!draft.reason}
    error={error ?? (prepare.error ? errorMessage(prepare.error) : undefined)}>
    <Stack><p>{t('objects.finalizeHint')}</p><FormField label={t('objects.outcome')}><select value={draft.outcome} disabled={busy} onChange={(e) => change({ outcome: e.target.value as Draft['outcome'] })}>
      <option value="">{t('objects.choose')}</option>
      {(['cancelled', 'failed', 'succeeded'] as const).map((outcome) => <option key={outcome} value={outcome}>{t(`objects.outcome.${outcome}`)}</option>)}
    </select></FormField><FormField label={t('objects.finalizeReason')}><textarea value={draft.reason} disabled={busy} maxLength={1024} onChange={(e) => change({ reason: e.target.value })} /></FormField>
      <FormField label={t('objects.finalizeArtifacts')}><select value={draft.mode} disabled={busy} onChange={(e) => change({ mode: e.target.value as Draft['mode'] })}>
        <option value="">{t('objects.choose')}</option><option value="files">{t('objects.finalizeFiles')}</option><option value="empty">{t('objects.finalizeEmpty')}</option>
      </select></FormField>
      {draft.mode === 'empty' ? <FormField label={t('objects.finalizeEmptyReason')}><textarea disabled={busy} value={draft.emptyReason} maxLength={1024} onChange={(e) => change({ emptyReason: e.target.value })} /></FormField> : null}
      {draft.mode === 'files' ? <ArchiveFields entries={draft.entries} disabled={busy} change={(entries) => change({ entries })} /> : null}
    </Stack>
  </FormDialog>{confirmation ? <ConfirmDialog title={t('objects.finalizeConfirm')} question={t('objects.finalizeIrreversible')} confirmWord="delete" busy={finish.isPending}
    confirmLabel={t('objects.finalizeSubmit')} onCancel={() => setConfirmation(undefined)} onConfirm={() => { if (sending.current) return; sending.current = true; finish.mutate(confirmation.input, { onSettled: () => { sending.current = false; } }); }}>
    <Stack><p>{t('objects.finalizeStopHint')}</p><p className={styles.code}>{taskId}</p><p>{t('objects.finalizeVolume')}: {confirmation.preview.task.volumeUid ?? t('objects.unknownValue')}</p>
      <p>{t('objects.finalizeActive')}: {confirmation.preview.activeExecutions} · {t('objects.finalizeUnknown')}: {confirmation.preview.unknownExecutions}</p>
      <p>{t('objects.outcome')}: {t(`objects.outcome.${confirmation.input.outcome}`)}</p><p>{confirmation.input.reason}</p>
      {confirmation.paths.length ? <ul>{confirmation.paths.map((path) => <li className={styles.code} key={path}>{path}</li>)}</ul> : <p>{'noArtifactsReason' in confirmation.input.archive ? confirmation.input.archive.noArtifactsReason : ''}</p>}
      {finish.error ? <p role="alert">{errorMessage(finish.error)}</p> : null}
    </Stack>
  </ConfirmDialog> : null}</>;
}

export function ArchiveFields({ entries, disabled, change }: { entries: Draft['entries']; disabled: boolean; change: (entries: Draft['entries']) => void }) {
  const t = useT(), update = (index: number, patch: Partial<Extract<Draft['entries'][number], { kind: 'file' }>>) => change(entries.map((entry, i) => i === index && entry.kind === 'file' ? { ...entry, ...patch } : entry));
  return <Stack><p>{t('objects.finalizeFilesHint')}</p>{entries.map((entry, index) => entry.kind === 'file' ? <div className={styles.formGrid} key={index}>
    <FormField label={`${t('objects.finalizePath')} ${index + 1}`}><input disabled={disabled} value={entry.path} onChange={(e) => update(index, { path: e.target.value })} /></FormField>
    <FormField label={`${t('objects.finalizeName')} ${index + 1}`}><input disabled={disabled} value={entry.name} onChange={(e) => update(index, { name: e.target.value })} /></FormField>
    <label><input type="checkbox" disabled={disabled} checked={entry.required} onChange={(e) => update(index, { required: e.target.checked })} />{t('objects.finalizeRequired')}</label>
    <Button disabled={disabled || entries.length === 1} onClick={() => change(entries.filter((_, i) => i !== index))}>{t('objects.finalizeRemove')}</Button>
  </div> : null)}<Button disabled={disabled || entries.length >= 100} onClick={() => change([...entries, { kind: 'file', name: '', path: '', required: true }])}>{t('objects.finalizeAdd')}</Button></Stack>;
}
