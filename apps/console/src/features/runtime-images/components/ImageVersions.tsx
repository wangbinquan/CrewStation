import { ImageActionConfirmation } from './ImageActionConfirmation';
import { ImageHistory } from './ImageHistory';
import { RuntimeImageValidationTargetSchema } from '@crewstation/contracts';
import type { RuntimeImageVersionDto, RuntimeImageValidationDto } from '@crewstation/contracts';
import { useRef, useState } from 'react';
import { api } from '../../../shared/api/client';
import { AUTO_REFRESH, errorMessage, useApiMutation, useApiQuery } from '../../../shared/api/useApi';
import { useT } from '../../../shared/lib/useT';
import { Button } from '../../../shared/ui/Button';
import { DataTable } from '../../../shared/ui/DataTable';
import { QueryStatus } from '../../../shared/ui/QueryStatus';
import { ActionNote } from '../../../shared/ui/ActionNote';
import { FormDialog } from '../../../shared/ui/dialog/FormDialog';
import { Dialog } from '../../../shared/ui/dialog/Dialog';
import { FormField } from '../../../shared/ui/FormField';
import { VersionReferences } from './VersionReferences';
import { ValidationEditor } from './ValidationEditor';
import { validationDraft } from '../model/imageDraft';
import styles from './RuntimeImages.module.css';

export function ImageVersions({ projectId, imageId, editable, manageable, owned }: { readonly projectId: string | undefined; readonly imageId: string; readonly editable: boolean; readonly owned: boolean; readonly manageable: boolean }) {
  const t = useT(), key = ['runtime-images', projectId, imageId, 'versions'];
  const [before, setBefore] = useState<string>(), [selected, setSelected] = useState<RuntimeImageVersionDto>(), [history, setHistory] = useState(false);
  const versions = useApiQuery([...key, before], () => api.runtimeImages.versions(projectId, imageId, { before, limit: 20 }), AUTO_REFRESH);
  const [technical, setTechnical] = useState<RuntimeImageVersionDto>();
  const [disabling, setDisabling] = useState<RuntimeImageVersionDto>();
  const disable = useApiMutation((id: string) => api.runtimeImages.disable(projectId, imageId, id), { invalidate: [['runtime-images']], onSuccess: () => setDisabling(undefined) });
  return <div className={styles.stack}>
    <h3>{t('images.versions')}</h3><p className={styles.note}>{t('images.versionsHint')}</p><QueryStatus isPending={versions.isPending} error={versions.error} isEmpty={versions.data?.items.length === 0} emptyTitle={t('images.noVersion')} />
    {versions.data?.items.length ? <DataTable columns={[t('images.version'), t('images.state'), t('images.actions')]}>
      {versions.data.items.map((version) => <tr key={version.id}><td><p>{new Date(version.createdAt).toLocaleString()}</p><p className={styles.identity}>{version.digest.slice(0, 19)} · {version.architecture}</p><Button size="small" onClick={() => setTechnical(version)}>{t('images.technicalDetails')}</Button></td><td>{t(`images.state.${version.state}`)}</td><td><div className={styles.row}>
        {editable ? <Button size="small" onClick={() => { setSelected(version); setHistory(false); }}>{t('images.validation')}</Button> : null}<Button size="small" onClick={() => { setSelected(version); setHistory(true); }}>{t('images.history')}</Button>
        {manageable && owned && version.state === 'available' ? <Button size="small" variant="danger" disabled={disable.isPending} onClick={() => { disable.reset(); setDisabling(version); }}>{t('images.disable')}</Button> : null}
      </div></td></tr>)}
    </DataTable> : null}
    {technical ? <Dialog title={t('images.technicalDetails')} onClose={() => setTechnical(undefined)}><p className={styles.identity}>{technical.id}</p><p className={styles.identity}>{technical.digest}</p><p>{technical.architecture}</p></Dialog> : null}
    {disabling ? <ImageActionConfirmation title={t('images.disable')} target={<p className={styles.identity}>{disabling.digest} · {disabling.architecture}</p>} hint={t('images.confirmDisableVersion')} busy={disable.isPending} error={disable.error} onCancel={() => setDisabling(undefined)} onConfirm={() => disable.mutate(disabling.id)} /> : null}
    <div className={styles.row}>{before ? <Button onClick={() => setBefore(undefined)}>{t('images.first')}</Button> : null}{versions.data?.items.length === 20 ? <Button onClick={() => setBefore(versions.data!.items.at(-1)!.id)}>{t('images.next')}</Button> : null}</div>
    {selected ? <Dialog title={t(history ? 'images.history' : 'images.validation')} size="large" onClose={() => setSelected(undefined)}>
    {history ? <ImageHistory key={selected.id} projectId={projectId} imageId={imageId} versionId={selected.id} /> : null}
    {selected && !history ? <VersionValidation key={selected.id} projectId={projectId} imageId={imageId} version={versions.data?.items.find((version) => version.id === selected.id) ?? selected} editable={editable} /> : null}
    {selected && !history && editable ? <VersionReferences key={`refs:${selected.id}`} projectId={projectId} imageId={imageId} version={versions.data?.items.find((version) => version.id === selected.id) ?? selected} manageable={manageable && owned} /> : null}
    </Dialog> : null}
  </div>;
}

function VersionValidation({ projectId, imageId, version, editable }: { readonly projectId: string | undefined; readonly imageId: string; readonly version: RuntimeImageVersionDto; readonly editable: boolean }) {
  const t = useT(), key = ['runtime-images', projectId, imageId, 'validations', version.id];
  const [editing, setEditing] = useState(false), [draft, setDraft] = useState(validationDraft('task'));
  const [consumerProjectId, setConsumerProjectId] = useState(projectId ?? '');
  const projects = useApiQuery(['runtime-images', 'validation-projects'], () => api.projects.list(), { ...AUTO_REFRESH, enabled: projectId === undefined });
  const request = useRef<{ draft: string; key: string } | undefined>(undefined);
  const validations = useApiQuery(key, () => api.runtimeImages.validations(projectId, imageId, version.id), { refetchIntervalMs: 3_000 });
  const start = useApiMutation(() => {
    const target = RuntimeImageValidationTargetSchema.parse(JSON.parse(draft));
    if (!consumerProjectId) throw new Error(t('images.chooseValidationProject'));
    const content = JSON.stringify({ draft, consumerProjectId });
    if (request.current?.draft !== content) request.current = { draft: content, key: crypto.randomUUID() };
    return api.runtimeImages.validate(projectId, imageId, version.id, { requestKey: request.current.key, target, ...(projectId === undefined ? { projectId: consumerProjectId } : {}) });
  }, { invalidate: [key], onSuccess: () => { setEditing(false); request.current = undefined; } });
  const [cancelling, setCancelling] = useState<RuntimeImageValidationDto>();
  const cancel = useApiMutation((id: string) => api.runtimeImages.cancelValidation(projectId, imageId, version.id, id, `cancel:${id}`), { invalidate: [key], onSuccess: () => setCancelling(undefined) });
  return <div className={styles.stack}>
    <div className={styles.row}><h4>{t('images.validation')}</h4>{editable && version.state === 'available' ? <Button onClick={() => setEditing(true)}>{t('images.validate')}</Button> : null}</div>
    <p className={styles.identity}>{version.id}</p><QueryStatus isPending={validations.isPending} error={validations.error} />
    {validations.data?.items.map((item) => <div key={item.id}>
      <strong>{t(`images.usage.${item.target.usage}`)} · {t(`images.state.${item.state}`)}</strong>
      {projectId === undefined ? <p>{projects.data?.items.find((entry) => entry.id === item.projectId)?.name ?? t('images.projectNumber', { id: item.projectId.slice(-12) })}</p> : null}
      {item.target.usage === 'agent' ? <p className={styles.identity}>{item.target.profile.profileId} · {item.target.profile.revision}</p> : null}
      {item.verification === 'service-contract' ? <p>{t('images.serviceContract')}</p> : null}
      {item.observedImageId ? <p className={styles.identity}>{item.observedImageId}</p> : null}
      {item.error ? <ActionNote tone="error">{item.error}</ActionNote> : null}
      {item.checks.map((check) => <pre key={check.key} className={styles.code}>{check.passed ? '✓' : '✕'} {check.key}{'\n'}{check.output}</pre>)}
      {editable && ['queued', 'running'].includes(item.state) ? <Button size="small" variant="danger" disabled={cancel.isPending} onClick={() => { cancel.reset(); setCancelling(item); }}>{t('images.cancelValidation')}</Button> : null}
    </div>)}
    {cancelling ? <ImageActionConfirmation title={t('images.cancelValidation')} target={<p>{t(`images.usage.${cancelling.target.usage}`)} · {new Date(cancelling.createdAt).toLocaleString()} · {cancelling.id}</p>} hint={t('images.confirmCancelValidation')} busy={cancel.isPending} error={cancel.error} onCancel={() => setCancelling(undefined)} onConfirm={() => cancel.mutate(cancelling.id)} /> : null}
    {editing ? <FormDialog title={t('images.validate')} submitLabel={t('images.validate')} busy={start.isPending} submitDisabled={!consumerProjectId} onClose={() => setEditing(false)} onSubmit={() => start.mutate()} error={start.error ? errorMessage(start.error) : undefined}>
      {projectId === undefined ? <><FormField label={t('images.validationProject')} hint={t('images.validationProjectHint')}><select value={consumerProjectId} onChange={(event) => setConsumerProjectId(event.target.value)}><option value="">{t('images.chooseValidationProject')}</option>{projects.data?.items.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></FormField><QueryStatus isPending={projects.isPending} error={projects.error} /></> : null}
      <p>{t('images.validationHint')}</p>{consumerProjectId ? <ValidationEditor projectId={consumerProjectId} value={draft} onChange={setDraft} /> : null}
    </FormDialog> : null}
  </div>;
}
