import { useState } from 'react';
import type { ResourceActionDescriptor, ResourceValues } from '@crewstation/contracts';
import { api } from '../../../shared/api/client';
import { errorMessage, useApiMutation, useApiQuery, isApiClientError } from '../../../shared/api/useApi';
import { useT } from '../../../shared/lib/useT';
import { FormDialog } from '../../../shared/ui/dialog/FormDialog';
import { ConfirmationDialog } from '../../../shared/ui/dialog/ConfirmationDialog';
import { FormField } from '../../../shared/ui/FormField';
import { QueryStatus } from '../../../shared/ui/QueryStatus';
import { ResourceFields, ValueComparison } from './ResourceFields';
import { actionLabel, formValues, initialDraft } from '../model/workspace';
import type { ResourceDraft } from '../model/workspace';
import { resourceCenterKey } from '../model/useResourceCenter';
import styles from './ResourceCenter.module.css';

export function ResourceActionDialog({ projectId, name, action, draft, onDraft, onClose, onDone }: { projectId: string; name: string; action: ResourceActionDescriptor; draft: ResourceDraft; onDraft: (draft: ResourceDraft) => void; onClose: () => void; onDone: (requestId?: string) => void }) {
  const t = useT(), [confirm, setConfirm] = useState<ResourceValues>(), [validation, setValidation] = useState(''), [conflicted, setConflicted] = useState(false), [reconfirmed, setReconfirmed] = useState(false);
  const query = useApiQuery(['resource-target', projectId, action.id], () => api.resourceCenter.inspect(projectId, action.target!), { enabled: !!action.target, staleTimeMs: 0 });
  const policy = action.kind === 'catalog-policy', fields = policy ? action.fields : query.data?.view.fields ?? action.fields;
  const current = policy ? { requestable: query.data?.policy?.requestable ?? false } : query.data?.view.current ?? action.current ?? {};
  const freshAction = query.data?.actions.find((a) => a.kind === action.kind && a.target?.action === action.target?.action);
  const allowed = !!query.data && !query.error && (policy || freshAction?.enabled === true) && (!conflicted || reconfirmed);
  const mutation = useApiMutation(async (values: ResourceValues) => {
    if (!query.data || !action.target) throw new Error(t('resourceCenter.unavailable'));
    if (policy) { await api.resourceCenter.saveCatalogPolicy(projectId, action.target, { expectedRevision: query.data.policy?.revision ?? 0, requestable: values['requestable'] === true }); return undefined; }
    const input = { target: action.target, expectedRevision: query.data.view.revision, values, reason: draft.reason.trim(), requestKey: draft.key };
    return action.kind === 'request' ? api.resourceCenter.create(projectId, input) : api.resourceCenter.direct(projectId, input);
  }, { invalidate: [resourceCenterKey(projectId)], onSuccess: (result) => onDone(result?.id) });
  const error = validation || (mutation.error ? errorMessage(mutation.error) : '') || query.error?.message;
  const prepare = () => { setValidation(''); try { if (!policy && draft.reason.trim().length < 5) throw new Error(t('resourceCenter.reasonRequired')); setConfirm(formValues(fields, draft)); } catch (error) { setValidation(`${t('resourceCenter.invalid')}: ${errorMessage(error)}`); } };
  const submit = async () => { try { await mutation.mutateAsync(confirm!); } catch (error) { if (isApiClientError(error) && error.status === 409) { setConflicted(true); setReconfirmed(false); setConfirm(undefined); await query.refetch(); } } };
  return <><FormDialog title={`${actionLabel(action, t)} · ${name}`} size="large" submitLabel={t('resourceCenter.reviewSubmit')} submitDisabled={!allowed} busy={mutation.isPending} error={error} onSubmit={prepare} onClose={onClose} onClear={() => onDraft(initialDraft(current))} dirty={draft.reason !== '' || JSON.stringify(draft.values) !== JSON.stringify(initialDraft(current).values)}>
    <QueryStatus isPending={query.isPending} error={query.error} />
    {!freshAction?.enabled && !policy && query.data ? <p role="status">{freshAction?.reason ?? t('resourceCenter.readOnly')}</p> : null}
    <ValueComparison fields={fields} current={current} proposed={draft.values} />
    <ResourceFields fields={fields} values={draft.values} disabled={mutation.isPending} onChange={(key, value) => onDraft({ ...draft, values: { ...draft.values, [key]: value } })} />
    {!policy ? <FormField label={t('resourceCenter.reason')} hint={t('resourceCenter.reasonHint')}><textarea rows={3} maxLength={2000} value={draft.reason} onChange={(event) => onDraft({ ...draft, reason: event.target.value })} /></FormField> : <p className={styles.warning}>{t('resourceCenter.policyImpact')}</p>}
    <ul className={styles.impact}>{(query.data?.view.impact ?? action.impact).map((impact) => <li key={impact}>{impact}</li>)}</ul>
    {conflicted ? <FormField label={t('resourceCenter.conflictReview')} hint={t('resourceCenter.conflictHint')}><input type="checkbox" checked={reconfirmed} onChange={(event) => { setReconfirmed(event.target.checked); if (event.target.checked) onDraft({ ...draft, key: crypto.randomUUID() }); }} /></FormField> : null}
  </FormDialog>{confirm ? <ConfirmationDialog title={actionLabel(action, t)} question={t('resourceCenter.confirmChange', { name })} hint={action.kind === 'request' ? t('resourceCenter.applyHint') : t('resourceCenter.syncHint')} size="large" confirmLabel={t('resourceCenter.submit')} busy={mutation.isPending} confirmDisabled={!allowed} danger={action.target?.action === 'revoke'} onConfirm={() => { void submit(); }} onCancel={() => setConfirm(undefined)}>
    <ValueComparison fields={fields} current={current} proposed={confirm} />{error ? <p role="alert">{error}</p> : null}
  </ConfirmationDialog> : null}</>;
}
