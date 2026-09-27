import { VersionIdentity } from './VersionIdentity';
import { FormField } from '../../../shared/ui/FormField';
import { SaveDevelopmentRuntimeImagesSchema } from '@crewstation/contracts';
import type { RuntimeImageSelection, SaveDevelopmentRuntimeImages } from '@crewstation/contracts';
import { useState } from 'react';
import { api } from '../../../shared/api/client';
import { AUTO_REFRESH, errorMessage, useApiMutation, useApiQuery } from '../../../shared/api/useApi';
import { useT } from '../../../shared/lib/useT';
import { Card } from '../../../shared/ui/Card';
import { Button } from '../../../shared/ui/Button';
import { QueryStatus } from '../../../shared/ui/QueryStatus';
import { ActionNote } from '../../../shared/ui/ActionNote';
import { FormDialog } from '../../../shared/ui/dialog/FormDialog';
import { VersionBrowser } from './VersionBrowser';
import styles from './RuntimeImages.module.css';

export function DevelopmentImages({ projectId, editable }: { readonly projectId: string; readonly editable: boolean }) {
  const t = useT(), key = ['runtime-images', projectId, 'development'];
  const query = useApiQuery(key, () => api.runtimeImages.development(projectId), AUTO_REFRESH);
  const profiles = useApiQuery(['runtime-images', projectId, 'profiles'], () => api.catalog.listComputeProfiles(projectId), AUTO_REFRESH);
  const [draft, setDraft] = useState<SaveDevelopmentRuntimeImages>(), [open, setOpen] = useState(false);
  const save = useApiMutation(() => api.runtimeImages.saveDevelopment(projectId, SaveDevelopmentRuntimeImagesSchema.parse(draft)), { invalidate: [key], onSuccess: () => { setOpen(false); setDraft(undefined); } });
  const reload = useApiMutation(() => api.runtimeImages.development(projectId), { onSuccess: (latest) => { setDraft({ expectedRevision: latest.revision, developmentTask: latest.developmentTask, developmentAgents: latest.developmentAgents }); save.reset(); } });
  const name = (id: string) => profiles.data?.items.find((p) => p.id === id)?.name ?? id;
  const edit = () => { if (!draft && query.data) setDraft({ expectedRevision: query.data.revision, developmentTask: query.data.developmentTask, developmentAgents: query.data.developmentAgents }); setOpen(true); };
  return <Card title={t('images.development')} stacked actions={editable ? <Button disabled={!query.data || !!query.error} onClick={edit}>{t('images.configure')}</Button> : null}>
    <p>{t('images.policyHint')}</p><QueryStatus isPending={query.isPending} error={query.error} />
    <p>{t('images.usage.task')} · {query.data?.developmentTask.runtimeImageVersionId ? <VersionIdentity projectId={projectId} versionId={query.data.developmentTask.runtimeImageVersionId} /> : query.data ? t('runtimeImages.picker.platform') : '—'}</p>
    {query.data?.developmentAgents.map((agent) => <p key={agent.profileId} className={styles.identity}>{name(agent.profileId)} · {agent.selection.runtimeImageVersionId ? <VersionIdentity projectId={projectId} versionId={agent.selection.runtimeImageVersionId} /> : t('runtimeImages.picker.platform')}</p>)}
    {save.isSuccess ? <ActionNote tone="success">{t('images.policySaved')}</ActionNote> : null}
    {open && draft ? <FormDialog title={t('images.configure')} submitLabel={t('images.save')} busy={save.isPending} onClose={() => setOpen(false)} onSubmit={() => save.mutate()} error={save.error ? errorMessage(save.error) : undefined}>
      <div className={styles.stack}>
        <p>{t('images.policyEditorHint')}</p>
        {save.error ? <Button disabled={reload.isPending} onClick={() => reload.mutate()}>{t('images.replaceDraft')}</Button> : null}
        {reload.error ? <ActionNote tone="error">{errorMessage(reload.error)}</ActionNote> : null}
        <SelectionFields projectId={projectId} key={`task:${draft.expectedRevision}`} label={t('images.usage.task')} value={draft.developmentTask} onChange={(developmentTask) => setDraft({ ...draft, developmentTask })} />
        {draft.developmentAgents.map((agent) => <div key={`${agent.profileId}:${draft.expectedRevision}`} className={styles.stack}>
          <SelectionFields projectId={projectId} label={name(agent.profileId)} value={agent.selection} onChange={(selection) => setDraft({ ...draft, developmentAgents: draft.developmentAgents.map((a) => a.profileId === agent.profileId ? { ...a, selection } : a) })} />
          <Button variant="danger" onClick={() => setDraft({ ...draft, developmentAgents: draft.developmentAgents.filter((a) => a.profileId !== agent.profileId) })}>{t('images.removeAgent')}</Button>
        </div>)}
        <FormField label={t('images.addAgent')}><select value="" onChange={(event) => { if (event.target.value) setDraft({ ...draft, developmentAgents: [...draft.developmentAgents, { profileId: event.target.value, selection: {} }] }); }}>
          <option value="">{t('images.selectProfile')}</option>{profiles.data?.items.filter((p) => !draft.developmentAgents.some((a) => a.profileId === p.id)).map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
        </select></FormField><QueryStatus isPending={profiles.isPending} error={profiles.error} />
      </div>
    </FormDialog> : null}
  </Card>;
}

function SelectionFields({ projectId, label, value, onChange }: { readonly projectId: string; readonly label: string; readonly value: RuntimeImageSelection; readonly onChange: (value: RuntimeImageSelection) => void }) {
  const t = useT();
  const [choosing, setChoosing] = useState<'default' | 'allowed'>();
  const [allowed, setAllowed] = useState(value.allowedRuntimeImageVersionIds?.join('\n') ?? '');
  const select = (id: string) => {
    if (choosing === 'default') onChange({ ...value, runtimeImageVersionId: id });
    else { const ids = [...new Set([...(value.allowedRuntimeImageVersionIds ?? []), id])]; setAllowed(ids.join('\n')); onChange({ ...value, allowedRuntimeImageVersionIds: ids }); }
    setChoosing(undefined);
  };
  return <fieldset className={styles.stack}><legend>{label}</legend>
    <div className={styles.row}><Button onClick={() => setChoosing('default')}>{t('images.pickDefault')}</Button><Button onClick={() => setChoosing('allowed')}>{t('images.pickAllowed')}</Button></div>
    {choosing ? <VersionBrowser projectId={projectId} onSelect={select} /> : null}
    <p>{t('images.defaultVersion')} · {value.runtimeImageVersionId ? <VersionIdentity projectId={projectId} versionId={value.runtimeImageVersionId} /> : t('runtimeImages.picker.platform')}</p>
    <Button onClick={() => onChange({ ...value, runtimeImageVersionId: undefined })}>{t('images.usePlatformDefault')}</Button>
    {value.allowedRuntimeImageVersionIds?.map((id) => <div key={id} className={styles.row}><VersionIdentity projectId={projectId} versionId={id} /><Button size="small" onClick={() => { const ids = value.allowedRuntimeImageVersionIds!.filter((v) => v !== id); setAllowed(ids.join('\n')); onChange({ ...value, allowedRuntimeImageVersionIds: ids }); }}>{t('images.removeSelection')}</Button></div>)}
    <details><summary>{t('images.advancedSelection')}</summary><FormField label={t('images.defaultVersion')}><input value={value.runtimeImageVersionId ?? ''} placeholder={t('runtimeImages.picker.platform')} onChange={(event) => onChange({ ...value, runtimeImageVersionId: event.target.value || undefined })} /></FormField>
    <FormField label={t('images.allowedVersions')}><textarea rows={3} value={allowed} onChange={(event) => { setAllowed(event.target.value); onChange({ ...value, allowedRuntimeImageVersionIds: event.target.value.split(/\s+/).filter(Boolean) }); }} /></FormField>
    </details>
  </fieldset>;
}
