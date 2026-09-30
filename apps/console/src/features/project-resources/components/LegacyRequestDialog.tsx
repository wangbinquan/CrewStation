import { useState } from 'react';
import type { LegacyResourceRequest } from '@crewstation/contracts';
import { api } from '../../../shared/api/client';
import { useApiMutation, errorMessage } from '../../../shared/api/useApi';
import { useT } from '../../../shared/lib/useT';
import { Dialog } from '../../../shared/ui/dialog/Dialog';
import { ConfirmationDialog } from '../../../shared/ui/dialog/ConfirmationDialog';
import { FormField } from '../../../shared/ui/FormField';
import { Button } from '../../../shared/ui/Button';
import { ActionRow } from '../../../shared/ui/ActionRow';
import { ValueComparison } from './ResourceFields';
import { resourceCenterKey } from '../model/useResourceCenter';

export function LegacyRequestDialog({ projectId, request, reason, onReason, onClose }: { projectId: string; request: LegacyResourceRequest; reason: string; onReason: (text: string) => void; onClose: () => void }) {
  const t = useT(), [approve, setApprove] = useState<boolean>();
  const mutation = useApiMutation(async (yes: boolean) => request.resourceType === 'api-operation' ? api.apiCatalog.decideRequest(request.id, { approve: yes, decision: reason }) : api.tasks.decideDataBinding(request.id, { approve: yes, decision: reason }), { invalidate: [resourceCenterKey(projectId)], onSuccess: onClose });
  return <><Dialog title={`${t('resourceCenter.legacy')} · ${request.name}`} size="large" onClose={onClose} busy={mutation.isPending} footer={<ActionRow>{request.canDecide ? <><Button variant="primary" disabled={reason.trim().length < 5} onClick={() => setApprove(true)}>{t('resourceCenter.approve')}</Button><Button variant="danger" disabled={reason.trim().length < 5} onClick={() => setApprove(false)}>{t('resourceCenter.reject')}</Button></> : null}<Button variant="ghost" onClick={onClose}>{t('resourceCenter.close')}</Button></ActionRow>}>
    <p>{request.requesterName ?? request.requestedBy} · {new Date(request.createdAt).toLocaleString()}</p><p>{request.reason}</p><ValueComparison fields={[]} current={{}} proposed={request.values} />
    {request.canDecide ? <FormField label={t('resourceCenter.decisionReason')} hint={t('resourceCenter.legacyHint')}><textarea rows={3} maxLength={500} value={reason} onChange={(event) => onReason(event.target.value)} /></FormField> : null}
    {mutation.error ? <p role="alert">{errorMessage(mutation.error)}</p> : null}
  </Dialog>{approve !== undefined ? <ConfirmationDialog question={t('resourceCenter.confirmChange', { name: request.name })} confirmLabel={t(approve ? 'resourceCenter.approve' : 'resourceCenter.reject')} busy={mutation.isPending} danger={!approve} onConfirm={() => mutation.mutate(approve)} onCancel={() => setApprove(undefined)}>{mutation.error ? <p role="alert">{errorMessage(mutation.error)}</p> : null}</ConfirmationDialog> : null}</>;
}
