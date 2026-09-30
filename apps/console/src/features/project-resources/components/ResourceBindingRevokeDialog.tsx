import { useState } from 'react';
import { api } from '../../../shared/api/client';
import { errorMessage, useApiMutation, useApiQuery } from '../../../shared/api/useApi';
import { useT } from '../../../shared/lib/useT';
import { FormDialog } from '../../../shared/ui/dialog/FormDialog';
import { ConfirmationDialog } from '../../../shared/ui/dialog/ConfirmationDialog';
import { FormField } from '../../../shared/ui/FormField';
import { QueryStatus } from '../../../shared/ui/QueryStatus';
import { resourceCenterKey } from '../model/useResourceCenter';

/** Existing production bindings retain their audit identity when revoked here. */
export function ResourceBindingRevokeDialog({ projectId, bindingId, reason, onReason, onClose }: { projectId: string; bindingId: string; reason: string; onReason: (value: string) => void; onClose: () => void }) {
  const t = useT(), [confirm, setConfirm] = useState(false);
  const query = useApiQuery(['resource-binding-revoke', projectId, bindingId], () => api.tasks.listProjectDataBindings(projectId), { staleTimeMs: 0 });
  const binding = query.data?.items.find((b) => b.id === bindingId), available = !!binding && binding.mode !== 'development' && binding.state === 'active' && !!binding.expiresAt && Date.parse(binding.expiresAt) > query.dataUpdatedAt;
  const mutation = useApiMutation(async () => { const fresh = (await query.refetch()).data?.items.find((b) => b.id === bindingId); if (!fresh || fresh.mode === 'development' || fresh.state !== 'active' || !fresh.expiresAt || Date.parse(fresh.expiresAt) <= Date.now()) throw new Error(t('resourceCenter.unavailable')); return api.tasks.revokeDataBinding(bindingId, { decision: reason.trim() }); }, { invalidate: [resourceCenterKey(projectId)], onSuccess: onClose });
  return <><FormDialog title={t('resourceCenter.revokeBinding')} onClose={onClose} onSubmit={() => setConfirm(true)} submitDisabled={!available || reason.trim().length < 5} submitLabel={t('resourceCenter.reviewSubmit')} busy={mutation.isPending} error={mutation.error ? errorMessage(mutation.error) : query.error?.message} dirty={reason.length > 0} onClear={() => onReason('')}>
    <QueryStatus isPending={query.isPending} error={query.error} /><p>{available ? t('resourceCenter.revokeBindingImpact') : t('resourceCenter.unavailable')}</p>
    {binding ? <p>{binding.mode} · {binding.taskId} · {binding.expiresAt}</p> : null}
    <FormField label={t('resourceCenter.reason')} hint={t('resourceCenter.reasonRequired')}><textarea value={reason} maxLength={500} rows={3} onChange={(event) => onReason(event.target.value)} /></FormField>
  </FormDialog>{confirm ? <ConfirmationDialog title={t('resourceCenter.revokeBinding')} question={t('resourceCenter.revokeBindingImpact')} confirmLabel={t('resourceCenter.submit')} confirmDisabled={!available} busy={mutation.isPending} danger onConfirm={() => mutation.mutate()} onCancel={() => setConfirm(false)}>{mutation.error ? <p role="alert">{errorMessage(mutation.error)}</p> : null}</ConfirmationDialog> : null}</>;
}
