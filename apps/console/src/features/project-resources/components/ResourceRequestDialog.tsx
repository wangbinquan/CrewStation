import { useState } from 'react';
import type { ResourceRequestDto, ResourceValues } from '@crewstation/contracts';
import { api } from '../../../shared/api/client';
import { errorMessage, useApiMutation, useApiQuery, isApiClientError } from '../../../shared/api/useApi';
import { useT } from '../../../shared/lib/useT';
import { Dialog } from '../../../shared/ui/dialog/Dialog';
import { ConfirmationDialog } from '../../../shared/ui/dialog/ConfirmationDialog';
import { FormField } from '../../../shared/ui/FormField';
import { ActionRow } from '../../../shared/ui/ActionRow';
import { Button } from '../../../shared/ui/Button';
import { Badge } from '../../../shared/ui/Badge';
import { QueryStatus } from '../../../shared/ui/QueryStatus';
import { ResourceFields, ValueComparison } from './ResourceFields';
import { formValues, isInFlight } from '../model/workspace';
import type { ResourceDraft } from '../model/workspace';
import { resourceCenterKey } from '../model/useResourceCenter';
import styles from './ResourceCenter.module.css';

export function ResourceRequestDialog({ projectId, initial, role, viewerId, archived, draft, onDraft, onClose, onDone }: { projectId: string; initial: ResourceRequestDto; role: string; viewerId?: string; archived: boolean; draft: ResourceDraft; onDraft: (draft: ResourceDraft) => void; onClose: () => void; onDone: () => void }) {
  const t = useT(), [confirm, setConfirm] = useState<{ operation: 'approve' | 'reject' | 'cancel' | 'retry'; values?: ResourceValues }>(), [validation, setValidation] = useState(''), [conflict, setConflict] = useState(false), [rechecked, setRechecked] = useState(false);
  const query = useApiQuery(['resource-request', projectId, initial.id], () => api.resourceCenter.request(projectId, initial.id), { staleTimeMs: 0, refetchIntervalMs: (data) => data && isInFlight(data.state) ? 5000 : undefined });
  const request = query.data ?? initial, editable = ['pending', 'needs-review'].includes(request.state), admin = role === 'admin', enabled = !!query.data && !query.error && !archived && (!conflict || rechecked);
  const inspection = useApiQuery(['request-inspect', projectId, initial.id], () => api.resourceCenter.inspect(projectId, initial.target), { enabled: admin && editable, staleTimeMs: 0 });
  const fields = inspection.data?.view.fields ?? [], current = inspection.data?.view.current ?? request.baseValues;
  const mutation = useApiMutation(async (input: NonNullable<typeof confirm>) => {
    if (input.operation === 'cancel') return api.resourceCenter.cancel(projectId, request.id, request.version);
    if (input.operation === 'retry') return api.resourceCenter.retry(projectId, request.id, request.version);
    return api.resourceCenter.decide(projectId, request.id, { expectedVersion: request.version, approve: input.operation === 'approve', expectedRevision: inspection.data?.view.revision ?? request.baseRevision, ...(input.operation === 'approve' ? { values: input.values! } : {}), reason: draft.reason.trim() });
  }, { invalidate: [resourceCenterKey(projectId), ['resource-request', projectId, initial.id]], onSuccess: () => { setConfirm(undefined); onDone(); } });
  const error = validation || (mutation.error ? errorMessage(mutation.error) : '');
  const prepare = (operation: NonNullable<typeof confirm>['operation']) => { setValidation(''); try { if ((operation === 'approve' || operation === 'reject') && draft.reason.trim().length < 5) throw new Error(t('resourceCenter.reasonRequired')); setConfirm({ operation, ...(operation === 'approve' ? { values: formValues(fields, draft) } : {}) }); } catch (error) { setValidation(errorMessage(error)); } };
  const submit = async () => { try { await mutation.mutateAsync(confirm!); } catch (error) { if (isApiClientError(error) && error.status === 409) { setConflict(true); setRechecked(false); setConfirm(undefined); await Promise.all([query.refetch(), inspection.refetch()]); } } };
  return <><Dialog title={`${t('resourceCenter.requestDetails')} · ${request.targetName}`} size="large" busy={mutation.isPending} onClose={onClose} footer={<ActionRow>
    {admin && editable ? <><Button variant="primary" disabled={!enabled || !inspection.data || !!inspection.error || !inspection.data.view.available} onClick={() => prepare('approve')}>{t('resourceCenter.approve')}</Button><Button variant="danger" disabled={!enabled} onClick={() => prepare('reject')}>{t('resourceCenter.reject')}</Button></> : null}
    {editable && (admin || (role === 'owner' && viewerId === request.requestedBy)) ? <Button disabled={!enabled} onClick={() => prepare('cancel')}>{t('resourceCenter.withdraw')}</Button> : null}
    {admin && ['apply-failed', 'applying'].includes(request.state) ? <Button disabled={!enabled} onClick={() => prepare('retry')}>{t('resourceCenter.retry')}</Button> : null}
    <Button variant="ghost" onClick={onClose} disabled={mutation.isPending}>{t('resourceCenter.close')}</Button>
  </ActionRow>}>
    <QueryStatus isPending={query.isPending} error={query.error} />
    <div className={styles.inline}><Badge tone={isInFlight(request.state) ? 'warning' : request.state === 'applied' ? 'success' : 'neutral'}>{t(`resourceCenter.requestState.${request.state}`)}</Badge><code>{request.id}</code></div>
    <dl className={styles.facts}><dt>{t('resourceCenter.requester')}</dt><dd>{request.requesterName ?? request.requestedBy}</dd><dt>{t('resourceCenter.created')}</dt><dd>{new Date(request.createdAt).toLocaleString()}</dd><dt>{t('resourceCenter.reason')}</dt><dd>{request.reason}</dd><dt>{t('resourceCenter.origin')}</dt><dd>{t(`resourceCenter.origin.${request.origin}`)}</dd></dl>
    <ValueComparison fields={fields} original={request.requestedValues} current={current} proposed={admin && editable ? draft.values : request.approvedValues ?? request.requestedValues} />
    {admin && editable ? <><QueryStatus isPending={inspection.isPending} error={inspection.error} /><ResourceFields fields={fields} values={draft.values} onChange={(key, value) => onDraft({ ...draft, values: { ...draft.values, [key]: value } })} /><FormField label={t('resourceCenter.decisionReason')} hint={t('resourceCenter.overrideHint')}><textarea rows={3} maxLength={2000} value={draft.reason} onChange={(event) => onDraft({ ...draft, reason: event.target.value })} /></FormField><ul className={styles.impact}>{inspection.data?.view.impact.map((v) => <li key={v}>{v}</li>)}</ul></> : null}
    {request.decidedBy ? <dl className={styles.facts}><dt>{t('resourceCenter.decider')}</dt><dd>{request.deciderName ?? request.decidedBy}</dd><dt>{t('resourceCenter.decisionReason')}</dt><dd>{request.decisionReason}</dd></dl> : null}
    {request.effect ? <p className={styles.muted}>{request.effect}</p> : null}{request.failure ? <p role="alert" className={styles.warning}>{request.failure}</p> : null}{error ? <p role="alert">{error}</p> : null}
    {conflict ? <FormField label={t('resourceCenter.conflictReview')} hint={t('resourceCenter.conflictHint')}><input type="checkbox" checked={rechecked} onChange={(event) => setRechecked(event.target.checked)} /></FormField> : null}
  </Dialog>{confirm ? <ConfirmationDialog title={t(`resourceCenter.${confirm.operation === 'cancel' ? 'withdraw' : confirm.operation}`)} question={t('resourceCenter.confirmChange', { name: request.targetName })} hint={t('resourceCenter.syncHint')} size="large" busy={mutation.isPending} confirmLabel={t('resourceCenter.submit')} onConfirm={() => { void submit(); }} onCancel={() => setConfirm(undefined)} confirmDisabled={!enabled} danger={confirm.operation === 'reject'}>
    <ValueComparison fields={fields} original={request.requestedValues} current={current} proposed={confirm.values ?? request.requestedValues} />{error ? <p role="alert">{error}</p> : null}
  </ConfirmationDialog> : null}</>;
}
