import { RuntimeImageValidationTargetSchema } from '@crewstation/contracts';
import type { RuntimeImageVersionDto } from '@crewstation/contracts';
import { useRef, useState } from 'react';
import { api } from '../../../shared/api/client';
import { AUTO_REFRESH, errorMessage, useApiMutation, useApiQuery } from '../../../shared/api/useApi';
import { useT } from '../../../shared/lib/useT';
import { Button } from '../../../shared/ui/Button';
import { DataTable } from '../../../shared/ui/DataTable';
import { QueryStatus } from '../../../shared/ui/QueryStatus';
import { ActionNote } from '../../../shared/ui/ActionNote';
import { FormDialog } from '../../../shared/ui/dialog/FormDialog';
import { VersionReferences } from './VersionReferences';
import { ValidationEditor } from './ValidationEditor';
import { validationDraft } from '../model/imageDraft';
import styles from './RuntimeImages.module.css';

export function ImageVersions({ projectId, imageId, editable, manageable, owned }: { readonly projectId: string; readonly imageId: string; readonly editable: boolean; readonly owned: boolean; readonly manageable: boolean }) {
  const t = useT(), key = ['runtime-images', projectId, imageId, 'versions'];
  const [before, setBefore] = useState<string>(), [selected, setSelected] = useState<RuntimeImageVersionDto>();
  const versions = useApiQuery([...key, before], () => api.runtimeImages.versions(projectId, imageId, { before, limit: 20 }), AUTO_REFRESH);
  const disable = useApiMutation((id: string) => api.runtimeImages.disable(projectId, imageId, id), { invalidate: [key] });
  return <div className={styles.stack}>
    <h3>{t('images.versions')}</h3><QueryStatus isPending={versions.isPending} error={versions.error} />
    {versions.data?.items.length ? <DataTable columns={[t('images.version'), t('images.state'), t('images.actions')]}>
      {versions.data.items.map((version) => <tr key={version.id}><td><p className={styles.identity}>{version.id}</p><p className={styles.identity}>{version.digest}</p>{version.architecture}</td><td>{t(`images.state.${version.state}`)}</td><td><div className={styles.row}>
        <Button size="small" onClick={() => setSelected(version)}>{t('images.validation')}</Button>
        {manageable && owned && version.state === 'available' ? <Button size="small" variant="danger" disabled={disable.isPending} onClick={() => disable.mutate(version.id)}>{t('images.disable')}</Button> : null}
      </div></td></tr>)}
    </DataTable> : null}
    {disable.error ? <ActionNote tone="error">{errorMessage(disable.error)}</ActionNote> : null}
    <div className={styles.row}>{before ? <Button onClick={() => setBefore(undefined)}>{t('images.first')}</Button> : null}{versions.data?.items.length === 20 ? <Button onClick={() => setBefore(versions.data!.items.at(-1)!.id)}>{t('images.next')}</Button> : null}</div>
    {selected && editable ? <VersionReferences key={`refs:${selected.id}`} projectId={projectId} imageId={imageId} version={versions.data?.items.find((version) => version.id === selected.id) ?? selected} manageable={manageable && owned} /> : null}
    {selected ? <VersionValidation key={selected.id} projectId={projectId} imageId={imageId} version={versions.data?.items.find((version) => version.id === selected.id) ?? selected} editable={editable} /> : null}
  </div>;
}

function VersionValidation({ projectId, imageId, version, editable }: { readonly projectId: string; readonly imageId: string; readonly version: RuntimeImageVersionDto; readonly editable: boolean }) {
  const t = useT(), key = ['runtime-images', projectId, imageId, 'validations', version.id];
  const [editing, setEditing] = useState(false), [draft, setDraft] = useState(validationDraft('task'));
  const request = useRef<{ draft: string; key: string } | undefined>(undefined);
  const validations = useApiQuery(key, () => api.runtimeImages.validations(projectId, imageId, version.id), { refetchIntervalMs: 3_000 });
  const start = useApiMutation(() => {
    const target = RuntimeImageValidationTargetSchema.parse(JSON.parse(draft));
    if (request.current?.draft !== draft) request.current = { draft, key: crypto.randomUUID() };
    return api.runtimeImages.validate(projectId, imageId, version.id, { requestKey: request.current.key, target });
  }, { invalidate: [key], onSuccess: () => { setEditing(false); request.current = undefined; } });
  const cancel = useApiMutation((id: string) => api.runtimeImages.cancelValidation(projectId, imageId, version.id, id, `cancel:${id}`), { invalidate: [key] });
  return <div className={styles.stack}>
    <div className={styles.row}><h4>{t('images.validation')}</h4>{editable && version.state === 'available' ? <Button onClick={() => setEditing(true)}>{t('images.validate')}</Button> : null}</div>
    <p className={styles.identity}>{version.id}</p><QueryStatus isPending={validations.isPending} error={validations.error} />
    {validations.data?.items.map((item) => <div key={item.id}>
      <strong>{t(`images.usage.${item.target.usage}`)} · {t(`images.state.${item.state}`)}</strong>
      {item.target.usage === 'agent' ? <p className={styles.identity}>{item.target.profile.profileId} · {item.target.profile.revision}</p> : null}
      {item.verification === 'service-contract' ? <p>{t('images.serviceContract')}</p> : null}
      {item.observedImageId ? <p className={styles.identity}>{item.observedImageId}</p> : null}
      {item.error ? <ActionNote tone="error">{item.error}</ActionNote> : null}
      {item.checks.map((check) => <pre key={check.key} className={styles.code}>{check.passed ? '✓' : '✕'} {check.key}{'\n'}{check.output}</pre>)}
      {editable && ['queued', 'running'].includes(item.state) ? <Button size="small" variant="danger" disabled={cancel.isPending} onClick={() => cancel.mutate(item.id)}>{t('images.cancelValidation')}</Button> : null}
    </div>)}
    {cancel.error ? <ActionNote tone="error">{errorMessage(cancel.error)}</ActionNote> : null}
    {editing ? <FormDialog title={t('images.validate')} submitLabel={t('images.validate')} busy={start.isPending} onClose={() => setEditing(false)} onSubmit={() => start.mutate()} error={start.error ? errorMessage(start.error) : undefined}>
      <p>{t('images.validationHint')}</p><ValidationEditor projectId={projectId} value={draft} onChange={setDraft} />
    </FormDialog> : null}
  </div>;
}
