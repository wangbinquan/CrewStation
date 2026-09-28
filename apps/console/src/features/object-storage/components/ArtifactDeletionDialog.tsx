import { useRef, useState } from 'react';
import type { ArchiveReceiptDto, DeleteArchiveArtifacts } from '@crewstation/contracts';
import { api } from '../../../shared/api/client';
import { errorMessage, useApiMutation } from '../../../shared/api/useApi';
import { useT } from '../../../shared/lib/useT';
import { FormField } from '../../../shared/ui/FormField';
import { Stack } from '../../../shared/ui/Stack';
import { ConfirmDialog } from '../../../shared/ui/dialog/ConfirmDialog';
import { FormDialog } from '../../../shared/ui/dialog/FormDialog';

export function ArtifactDeletionDialog({ receipt, open, close }: { receipt: ArchiveReceiptDto; open: boolean; close(): void }) {
  const t = useT(), [draft, setDraft] = useState({ reason: '', key: crypto.randomUUID() }), [confirmation, setConfirmation] = useState<DeleteArchiveArtifacts>(), sending = useRef(false);
  const mutation = useApiMutation((input: DeleteArchiveArtifacts) => api.objectStorage.deleteArtifacts(receipt.taskId, input), { invalidate: [['object-storage']], onSuccess: () => { setConfirmation(undefined); setDraft({ reason: '', key: crypto.randomUUID() }); close(); } });
  if (!open) return null;
  return <><FormDialog title={t('objects.deleteArtifacts')} onClose={close} onSubmit={() => setConfirmation({ requestKey: draft.key, reason: draft.reason.trim(), expectedReceiptId: receipt.id, confirmation: 'delete' })}
    submitDisabled={!draft.reason.trim() || !!confirmation} submitLabel={t('objects.deleteArtifactsPreview')} busy={mutation.isPending}>
    <Stack><p>{t('objects.deleteArtifactsHint')}</p><p>{t('objects.receiptId')}: {receipt.id}</p><FormField label={t('objects.deleteArtifactsReason')}>
      <input value={draft.reason} maxLength={1024} disabled={!!confirmation || mutation.isPending} onChange={(e) => setDraft({ reason: e.target.value, key: crypto.randomUUID() })} />
    </FormField></Stack>
  </FormDialog>{confirmation ? <ConfirmDialog title={t('objects.deleteArtifacts')} question={t('objects.deleteArtifactsConsequence')} confirmWord="delete" confirmLabel={t('objects.deleteArtifacts')} busy={mutation.isPending}
    onCancel={() => setConfirmation(undefined)} onConfirm={() => { if (sending.current) return; sending.current = true; mutation.mutate(confirmation, { onSettled: () => { sending.current = false; } }); }}>
    <Stack><p>{confirmation.reason}</p><p>{t('objects.receiptId')}: {confirmation.expectedReceiptId}</p>{mutation.error ? <p role="alert">{errorMessage(mutation.error)}</p> : null}</Stack>
  </ConfirmDialog> : null}</>;
}
