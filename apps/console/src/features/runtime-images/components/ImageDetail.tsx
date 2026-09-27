import { RecipeSummary } from './RecipeSummary';
import { Tabs } from '../../../shared/ui/Tabs';
import { ImageHistory } from './ImageHistory';
import { ImageMetadata } from './ImageMetadata';
import { ImageGrants } from './ImageGrants';
import { FormField } from '../../../shared/ui/FormField';
import { CreateRuntimeImageRevisionSchema } from '@crewstation/contracts';
import { useRef, useState } from 'react';
import { api } from '../../../shared/api/client';
import { AUTO_REFRESH, errorMessage, useApiMutation, useApiQuery } from '../../../shared/api/useApi';
import { useT } from '../../../shared/lib/useT';
import { Dialog } from '../../../shared/ui/dialog/Dialog';
import { Button } from '../../../shared/ui/Button';
import { QueryStatus } from '../../../shared/ui/QueryStatus';
import { ActionNote } from '../../../shared/ui/ActionNote';
import { FormDialog } from '../../../shared/ui/dialog/FormDialog';
import { revisionDraft } from '../model/imageDraft';
import { RecipeEditor } from './RecipeEditor';
import { BuildHistory } from './BuildHistory';
import { ImageVersions } from './ImageVersions';
import styles from './RuntimeImages.module.css';

export function ImageDetail({ projectId, imageId, editable, admin, manageable, initialTab = 'versions', onClose }: { readonly projectId: string | undefined; readonly imageId: string; readonly editable: boolean; readonly admin: boolean; readonly manageable: boolean; readonly initialTab?: 'versions' | 'settings'; readonly onClose: () => void }) {
  const t = useT(), key = ['runtime-images', projectId, imageId];
  const image = useApiQuery([...key, 'detail'], () => api.runtimeImages.get(projectId, imageId), AUTO_REFRESH);
  const owned = admin && projectId === undefined;
  const [before, setBefore] = useState<string>(), [tab, setTab] = useState<string>(initialTab);
  const revisions = useApiQuery([...key, 'revisions', before], () => api.runtimeImages.revisions(projectId, imageId, { before, limit: 20 }), { ...AUTO_REFRESH, enabled: owned && editable });
  const [editing, setEditing] = useState(false), [draft, setDraft] = useState(revisionDraft), [revisionId, setRevisionId] = useState('');
  const [uploading, setUploading] = useState(false);
  const buildKey = useRef<{ revision: string; key: string } | undefined>(undefined);
  const save = useApiMutation(async () => api.runtimeImages.createRevision(projectId, imageId, CreateRuntimeImageRevisionSchema.parse(JSON.parse(draft))), { invalidate: [key], onSuccess: (revision) => { setBefore(undefined); setRevisionId(revision.id); setEditing(false); } });
  const build = useApiMutation(() => {
    const revision = revisionId || revisions.data?.items[0]?.id;
    if (!revision) throw new Error(t('images.noRevision'));
    if (buildKey.current?.revision !== revision) buildKey.current = { revision, key: crypto.randomUUID() };
    return api.runtimeImages.startBuild(projectId, imageId, { revisionId: revision, requestKey: buildKey.current.key });
  }, { invalidate: [key], onSuccess: () => { buildKey.current = undefined; setTab('builds'); } });
  const share = useApiMutation(() => api.runtimeImages.update(projectId, imageId, { defaultVisible: !image.data!.defaultVisible, expectedRevision: image.data!.revision }), { invalidate: [['runtime-images']] });
  return <Dialog title={image.data?.name ?? t('images.detail')} size="large" initialFocus="dialog" onClose={onClose}><div className={styles.stack}>
    <QueryStatus isPending={image.isPending} error={image.error} />
    <p className={styles.note}>{t('images.detailHint')}</p>
    {owned && editable ? <div className={styles.row}>
      <FormField label={t('images.revision')}><select value={revisionId || revisions.data?.items[0]?.id || ''} onChange={(event) => setRevisionId(event.target.value)}>
        {revisionId && !revisions.data?.items.some((revision) => revision.id === revisionId) ? <option value={revisionId}>{revisionId}</option> : null}
        {revisions.data?.items.map((revision) => <option key={revision.id} value={revision.id}>{revision.revision} · {t(`images.usage.${revision.source.usage}`)} · {revision.commitSha?.slice(0, 12) ?? t(revision.source.kind === 'inline' ? 'images.sourceInline' : 'images.sourceExisting')}</option>)}
      </select></FormField>
      {before ? <Button onClick={() => { setBefore(undefined); setRevisionId(''); }}>{t('images.first')}</Button> : null}
      {revisions.data?.items.length === 20 ? <Button onClick={() => { setBefore(revisions.data!.items.at(-1)!.id); setRevisionId(''); }}>{t('images.next')}</Button> : null}
      {editable ? <><Button variant="primary" disabled={!image.data?.enabled || !revisions.data?.items.length || build.isPending || !!revisions.error} onClick={() => build.mutate()}>{t('images.build')}</Button><Button disabled={!image.data?.enabled} onClick={() => { if (draft === revisionDraft() && revisions.data?.items[0]) { const current = revisions.data.items.find((r) => r.id === revisionId) ?? revisions.data.items[0]; setDraft(JSON.stringify({ sourceProjectId: current.sourceProjectId, source: current.source, initializer: current.initializer, tools: current.tools }, null, 2)); } setEditing(true); }}>{t('images.editRecipe')}</Button></> : null}
      {admin ? <Button disabled={share.isPending} onClick={() => share.mutate()}>{t(image.data?.defaultVisible ? 'images.defaultHiddenAction' : 'images.defaultVisibleAction')}</Button> : null}
    </div> : <p>{t(owned ? 'images.recipeAccess' : 'images.sharedNote')}</p>}
    {owned && editable ? <QueryStatus isPending={revisions.isPending} error={revisions.error} /> : null}
    {build.error || share.error ? <ActionNote tone="error">{errorMessage(build.error ?? share.error)}</ActionNote> : null}
    {build.data ? <ActionNote tone="success">{t('images.buildAccepted', { id: build.data.id })}</ActionNote> : null}
    <Tabs label={t('images.detail')} value={tab} onChange={setTab} items={[{ value: 'versions', label: t('images.versions') }, ...(owned && editable ? [{ value: 'builds', label: t('images.buildTab') }, { value: 'grants', label: t('images.grants') }] : []), { value: 'history', label: t('images.history') }, { value: 'settings', label: t('images.manage') }]}>
      {tab === 'versions' ? <ImageVersions projectId={projectId} imageId={imageId} editable={editable} manageable={manageable} owned={owned} /> : null}
      {tab === 'builds' && owned ? <BuildHistory projectId={projectId} imageId={imageId} editable={editable} /> : null}
      {tab === 'history' ? <ImageHistory projectId={projectId} imageId={imageId} /> : null}
      {tab === 'grants' && owned ? <ImageGrants imageId={imageId} /> : null}
      {tab === 'settings' && image.data ? <div className={styles.stack}><ImageMetadata projectId={projectId} image={image.data} editable={editable && owned} manageable={manageable && owned} />{revisions.data?.items[0] ? <RecipeSummary revision={revisions.data.items.find((r) => r.id === revisionId) ?? revisions.data.items[0]} /> : null}</div> : null}
    </Tabs>
    {editing ? <FormDialog title={t('images.editRecipe')} submitLabel={t('images.saveRevision')} busy={save.isPending} submitDisabled={uploading} onClose={() => setEditing(false)} onSubmit={() => save.mutate()} error={save.error ? errorMessage(save.error) : undefined} dirty={draft !== revisionDraft()} onClear={() => setDraft(revisionDraft())}>
      <RecipeEditor projectId={projectId} value={draft} onChange={setDraft} onPendingChange={setUploading} />
    </FormDialog> : null}
  </div></Dialog>;
}
