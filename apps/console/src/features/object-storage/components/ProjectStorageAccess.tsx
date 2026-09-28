import { useState } from 'react';
import type { ObjectProjectPolicyDto, ObjectStoragePlanDto } from '@crewstation/contracts';
import { api } from '../../../shared/api/client';
import { AUTO_REFRESH, errorMessage, useApiMutation, useApiQuery } from '../../../shared/api/useApi';
import { useT } from '../../../shared/lib/useT';
import { FormField } from '../../../shared/ui/FormField';
import { QueryStatus } from '../../../shared/ui/QueryStatus';
import { Stack } from '../../../shared/ui/Stack';
import { FormDialog } from '../../../shared/ui/dialog/FormDialog';
import { storageBytes } from '../model/storageValues';
import styles from './Storage.module.css';

export function ProjectStorageAccess({ open, close, plans }: { open: boolean; close: () => void; plans: ObjectStoragePlanDto[] }) {
  const t = useT(), [projectId, setProjectId] = useState(''), [drafts, setDrafts] = useState<Record<string, ObjectProjectPolicyDto>>({});
  const projects = useApiQuery(['object-storage', 'projects'], () => api.projects.list(['DigitalWorker']), { ...AUTO_REFRESH, enabled: open });
  const policy = useApiQuery(['object-storage', 'policy', projectId], () => api.objectStorage.projectPolicy(projectId), { ...AUTO_REFRESH, enabled: open && !!projectId });
  const draft = drafts[projectId] ?? policy.data;
  const mutation = useApiMutation((value: ObjectProjectPolicyDto) => api.objectStorage.authorizePlans({ projectId: value.projectId, expectedRevision: value.revision, planIds: value.planIds }),
    { invalidate: [['object-storage']], onSuccess: (value) => { setDrafts((old) => ({ ...old, [value.projectId]: value })); close(); } });
  if (!open) return null;
  return <FormDialog title={t('objects.projectAccess')} submitLabel={t('objects.save')} busy={mutation.isPending} submitDisabled={!draft || policy.isPending || !!policy.error}
    error={mutation.error ? errorMessage(mutation.error) : undefined} onSubmit={() => { if (draft) mutation.mutate(draft); }} onClose={close}>
    <Stack><QueryStatus isPending={projects.isPending} error={projects.error} /><FormField label={t('objects.project')}><select value={projectId} disabled={mutation.isPending} onChange={(e) => { setProjectId(e.target.value); mutation.reset(); }}>
      <option value="">{t('objects.chooseProject')}</option>{projects.data?.items.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
    </select></FormField>{projectId ? <QueryStatus isPending={policy.isPending} error={policy.error} /> : null}
    {draft ? <fieldset disabled={mutation.isPending}><legend>{t('objects.authorizedPlans')}</legend><Stack>{plans.map((p) => <FormField key={p.id} label={`${p.name} · ${storageBytes(p.quotaBytes)}${p.enabled ? '' : ` · ${t('objects.disabled')}`}`}>
      <input type="checkbox" checked={draft.planIds.includes(p.id)} disabled={!p.enabled && !draft.planIds.includes(p.id)} onChange={(e) => setDrafts((old) => ({ ...old, [projectId]: { ...draft, planIds: e.target.checked ? [...draft.planIds, p.id] : draft.planIds.filter((id) => id !== p.id) } }))} />
    </FormField>)}</Stack></fieldset> : null}<p className={styles.muted}>{t('objects.accessHint')}</p></Stack>
  </FormDialog>;
}
