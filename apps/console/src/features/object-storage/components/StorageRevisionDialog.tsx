import { useRef, useState } from 'react';
import type { AdministrativeArchiveRevision, ArchiveRevisionPreview, FinalizationArchive, OperatorArchivePlan } from '@crewstation/contracts';
import { AdministrativeArchiveRevisionSchema, OperatorArchivePlanSchema } from '@crewstation/contracts';
import { api } from '../../../shared/api/client';
import { AUTO_REFRESH, errorMessage, useApiMutation, useApiQuery } from '../../../shared/api/useApi';
import { useT } from '../../../shared/lib/useT';
import { Stack } from '../../../shared/ui/Stack';
import { Button } from '../../../shared/ui/Button';
import { FormField } from '../../../shared/ui/FormField';
import { ActionRow } from '../../../shared/ui/ActionRow';
import { DataTable } from '../../../shared/ui/DataTable';
import { QueryStatus } from '../../../shared/ui/QueryStatus';
import { FormDialog } from '../../../shared/ui/dialog/FormDialog';
import { ConfirmDialog } from '../../../shared/ui/dialog/ConfirmDialog';
import { ArchiveFields } from './StorageFinalizeDialog';
import styles from './Storage.module.css';

interface Draft { mode: '' | 'files' | 'empty'; reason: string; emptyReason: string; requestKey: string; entries: OperatorArchivePlan['entries'] }
interface Selection { input: AdministrativeArchiveRevision; preview: ArchiveRevisionPreview }
const initial = (): Draft => ({ mode: '', reason: '', emptyReason: '', requestKey: crypto.randomUUID(), entries: [{ kind: 'file', path: '', name: '', required: true }] });
export function StorageRevisionDialog({ taskId, open, close }: { taskId: string; open: boolean; close: () => void }) {
  const t = useT(), [draft, setDraft] = useState(initial), [selected, setSelected] = useState<Selection>(), [error, setError] = useState<string>(), sending = useRef(false);
  const change = (patch: Partial<Draft>) => setDraft((old) => ({ ...old, ...patch, requestKey: crypto.randomUUID() }));
  const save = useApiMutation((input: AdministrativeArchiveRevision) => api.objectStorage.reviseArchive(taskId, input), { invalidate: [['object-storage']], onSuccess: () => { setSelected(undefined); setDraft(initial()); close(); } });
  const prepare = useApiMutation(async (input: Draft): Promise<Selection> => {
    const state = await api.objectStorage.finalizationPreview(taskId), op = state.finalization;
    if (!op || op.receipt || !['requested', 'draining', 'archiving'].includes(op.phase) || op.phaseState === 'revising') throw new Error(t('objects.revisionUnavailable'));
    let archive: FinalizationArchive;
    if (input.mode === 'empty') archive = { noArtifactsReason: input.emptyReason };
    else { const plan = await api.objectStorage.prepareArchive(taskId, OperatorArchivePlanSchema.parse({ requestKey: input.requestKey, reason: input.reason, entries: input.entries })); archive = { planId: plan.id, planRevision: plan.revision, digest: plan.digest! }; }
    const preview = await api.objectStorage.revisionPreview(taskId, { expectedRevision: op.revision, archive, offset: 0, limit: 100 });
    return { preview, input: AdministrativeArchiveRevisionSchema.parse({ requestKey: input.requestKey, expectedGeneration: preview.taskGeneration, expectedRevision: preview.revision, archive, reason: input.reason, confirmDiscard: false }) };
  }, { onSuccess: setSelected });
  const busy = prepare.isPending || save.isPending || !!selected;
  const submit = () => {
    if (busy || sending.current) return; setError(undefined);
    if (!draft.mode || !draft.reason.trim() || draft.mode === 'empty' && !draft.emptyReason.trim()) { setError(t('objects.revisionFormRequired')); return; }
    if (draft.mode === 'files' && !OperatorArchivePlanSchema.safeParse({ requestKey: draft.requestKey, reason: draft.reason, entries: draft.entries }).success) { setError(t('objects.invalidForm')); return; }
    sending.current = true; prepare.mutate(draft, { onSettled: () => { sending.current = false; } });
  };
  if (!open) return null;
  return <><FormDialog title={t('objects.revisionTitle')} submitLabel={t('objects.revisionPreview')} size="large" onSubmit={submit} onClose={close} busy={prepare.isPending || save.isPending} submitDisabled={!!selected}
    error={error ?? (prepare.error ? errorMessage(prepare.error) : undefined)} dirty={!!draft.mode || !!draft.reason} onClear={() => { setDraft(initial()); setError(undefined); prepare.reset(); }}>
    <Stack><p>{t('objects.revisionHint')}</p><FormField label={t('objects.revisionReason')}><textarea maxLength={1024} disabled={busy} value={draft.reason} onChange={(e) => change({ reason: e.target.value })} /></FormField>
      <FormField label={t('objects.finalizeArtifacts')}><select value={draft.mode} disabled={busy} onChange={(e) => change({ mode: e.target.value as Draft['mode'] })}>
        <option value="">{t('objects.choose')}</option><option value="files">{t('objects.finalizeFiles')}</option><option value="empty">{t('objects.finalizeEmpty')}</option>
      </select></FormField>
      {draft.mode === 'empty' ? <FormField label={t('objects.finalizeEmptyReason')}><textarea maxLength={1024} disabled={busy} value={draft.emptyReason} onChange={(e) => change({ emptyReason: e.target.value })} /></FormField> : null}
      {draft.mode === 'files' ? <ArchiveFields entries={draft.entries} disabled={busy} change={(entries) => change({ entries })} /> : null}
    </Stack>
  </FormDialog>{selected ? <RevisionConfirmation taskId={taskId} selection={selected} busy={save.isPending} error={save.error} cancel={() => setSelected(undefined)} confirm={(input) => {
    if (sending.current) return; sending.current = true; save.mutate(input, { onSettled: () => { sending.current = false; } });
  }} /> : null}</>;
}
function RevisionConfirmation({ taskId, selection, busy, error, cancel, confirm }: { taskId: string; selection: Selection; busy: boolean; error: unknown; cancel: () => void; confirm: (input: AdministrativeArchiveRevision) => void }) {
  const t = useT(), [offset, setOffset] = useState(0), input = selection.input;
  const query = useApiQuery(['object-storage', 'revision-preview', taskId, input.requestKey, offset], () => api.objectStorage.revisionPreview(taskId, { expectedRevision: input.expectedRevision, archive: input.archive, offset, limit: 100 }), AUTO_REFRESH);
  const preview = query.data, discard = selection.preview.discardedCount > 0;
  const changed = preview && (preview.operationId !== selection.preview.operationId || preview.taskGeneration !== input.expectedGeneration || preview.discardedCount !== selection.preview.discardedCount);
  return <ConfirmDialog title={t('objects.revisionTitle')} question={t(discard ? 'objects.revisionDiscardConsequence' : 'objects.revisionConsequence', { count: selection.preview.discardedCount })} confirmWord={discard ? 'discard' : 'archive'}
    confirmLabel={t('objects.revisionSubmit')} busy={busy} confirmDisabled={!preview || !!query.error || !!changed} onCancel={cancel} onConfirm={() => confirm({ ...input, confirmDiscard: discard })}>
    <Stack><p>{input.reason}</p><p className={styles.code}>{taskId}</p><p>{t('objects.finalizeVolume')}: {selection.preview.volumeUid ?? t('objects.unknownValue')}</p>
      <p>{t('objects.revisionCounts', { before: selection.preview.oldCount, after: selection.preview.newCount, removed: selection.preview.discardedCount })}</p><QueryStatus isPending={query.isPending} error={query.error} />
      {changed ? <p role="alert">{t('objects.revisionUnavailable')}</p> : null}
      <DataTable columns={[t('objects.finalizePath'), t('objects.name')]}>{preview?.discarded.map((entry) => entry.kind === 'file' ? <tr key={entry.path}><td className={styles.code}>{entry.path}</td><td>{entry.name}</td></tr> : null)}</DataTable>
      <ActionRow><Button disabled={!offset || busy} onClick={() => setOffset(Math.max(0, offset - 100))}>{t('objects.previous')}</Button><Button disabled={!preview || preview.nextOffset === null || busy} onClick={() => setOffset(preview!.nextOffset!)}>{t('objects.next')}</Button></ActionRow>
      {error ? <p role="alert">{errorMessage(error)}</p> : null}
    </Stack>
  </ConfirmDialog>;
}
