import { FormField } from '../../../shared/ui/FormField';
import { CreateRuntimeImageRevisionSchema } from '@crewstation/contracts';
import { useRef, useState } from 'react';
import { api } from '../../../shared/api/client';
import { AUTO_REFRESH, errorMessage, useApiMutation, useApiQuery } from '../../../shared/api/useApi';
import { useT } from '../../../shared/lib/useT';
import { Card } from '../../../shared/ui/Card';
import { Button } from '../../../shared/ui/Button';
import { QueryStatus } from '../../../shared/ui/QueryStatus';
import { ActionNote } from '../../../shared/ui/ActionNote';
import { FormDialog } from '../../../shared/ui/dialog/FormDialog';
import { revisionDraft } from '../model/imageDraft';
import { RecipeEditor } from './RecipeEditor';
import { BuildHistory } from './BuildHistory';
import { ImageVersions } from './ImageVersions';
import styles from './RuntimeImages.module.css';

export function ImageDetail({ projectId, imageId, editable, admin, manageable }: { readonly projectId: string; readonly imageId: string; readonly editable: boolean; readonly admin: boolean; readonly manageable: boolean }) {
  const t = useT(), key = ['runtime-images', projectId, imageId];
  const image = useApiQuery([...key, 'detail'], () => api.runtimeImages.get(projectId, imageId), AUTO_REFRESH);
  const owned = image.data?.projectId === projectId;
  const [before, setBefore] = useState<string>();
  const revisions = useApiQuery([...key, 'revisions', before], () => api.runtimeImages.revisions(projectId, imageId, { before, limit: 20 }), { ...AUTO_REFRESH, enabled: owned });
  const [editing, setEditing] = useState(false), [draft, setDraft] = useState(revisionDraft), [revisionId, setRevisionId] = useState('');
  const buildKey = useRef<{ revision: string; key: string } | undefined>(undefined);
  const save = useApiMutation(async () => api.runtimeImages.createRevision(projectId, imageId, CreateRuntimeImageRevisionSchema.parse(JSON.parse(draft))), { invalidate: [key], onSuccess: (revision) => { setBefore(undefined); setRevisionId(revision.id); setEditing(false); } });
  const build = useApiMutation(() => {
    const revision = revisionId || revisions.data?.items[0]?.id;
    if (!revision) throw new Error(t('images.noRevision'));
    if (buildKey.current?.revision !== revision) buildKey.current = { revision, key: crypto.randomUUID() };
    return api.runtimeImages.startBuild(projectId, imageId, { revisionId: revision, requestKey: buildKey.current.key });
  }, { invalidate: [key], onSuccess: () => { buildKey.current = undefined; } });
  const share = useApiMutation(() => api.runtimeImages.share(projectId, imageId, image.data!.scope === 'shared' ? 'project' : 'shared', image.data!.revision), { invalidate: [['runtime-images', projectId]] });
  return <Card title={image.data?.name ?? t('images.detail')} stacked>
    <QueryStatus isPending={image.isPending} error={image.error} />
    <p className={styles.identity}>{imageId}</p>
    {owned ? <div className={styles.row}>
      <FormField label={t('images.revision')}><select value={revisionId || revisions.data?.items[0]?.id || ''} onChange={(event) => setRevisionId(event.target.value)}>
        {revisionId && !revisions.data?.items.some((revision) => revision.id === revisionId) ? <option value={revisionId}>{revisionId}</option> : null}
        {revisions.data?.items.map((revision) => <option key={revision.id} value={revision.id}>{revision.revision} · {revision.source.usage} · {revision.commitSha?.slice(0, 12) ?? revision.source.kind}</option>)}
      </select></FormField>
      {before ? <Button onClick={() => { setBefore(undefined); setRevisionId(''); }}>{t('images.first')}</Button> : null}
      {revisions.data?.items.length === 20 ? <Button onClick={() => { setBefore(revisions.data!.items.at(-1)!.id); setRevisionId(''); }}>{t('images.next')}</Button> : null}
      {editable ? <><Button variant="primary" disabled={!revisions.data?.items.length || build.isPending || !!revisions.error} onClick={() => build.mutate()}>{t('images.build')}</Button><Button onClick={() => setEditing(true)}>{t('images.editRecipe')}</Button></> : null}
      {admin ? <Button disabled={share.isPending} onClick={() => share.mutate()}>{t(image.data?.scope === 'shared' ? 'images.unshare' : 'images.share')}</Button> : null}
    </div> : <p>{t('images.sharedNote')}</p>}
    {owned ? <QueryStatus isPending={revisions.isPending} error={revisions.error} /> : null}
    {build.error || share.error ? <ActionNote tone="error">{errorMessage(build.error ?? share.error)}</ActionNote> : null}
    {build.data ? <ActionNote tone="success">{t('images.buildAccepted', { id: build.data.id })}</ActionNote> : null}
    {owned ? <BuildHistory projectId={projectId} imageId={imageId} editable={editable} /> : null}
    <ImageVersions projectId={projectId} imageId={imageId} editable={editable} manageable={manageable} owned={owned} />
    {editing ? <FormDialog title={t('images.editRecipe')} submitLabel={t('images.saveRevision')} busy={save.isPending} onClose={() => setEditing(false)} onSubmit={() => save.mutate()} error={save.error ? errorMessage(save.error) : undefined} dirty={draft !== revisionDraft()} onClear={() => setDraft(revisionDraft())}>
      <RecipeEditor projectId={projectId} value={draft} onChange={setDraft} />
    </FormDialog> : null}
  </Card>;
}
