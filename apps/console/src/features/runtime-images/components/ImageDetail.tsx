import { ActionRow } from '../../../shared/ui/ActionRow';
import { CatalogPage } from '../../../shared/ui/catalog/CatalogPage';
import { Card } from '../../../shared/ui/Card';
import { ImageVisibility } from './ImageVisibility';
import { RecipeSummary } from './recipe/RecipeSummary';
import { Tabs } from '../../../shared/ui/Tabs';
import { ImageHistory } from './ImageHistory';
import { ImageMetadata } from './ImageMetadata';
import { ImageGrants } from './ImageGrants';
import { FormField } from '../../../shared/ui/FormField';
import { parseRecipe } from '../model/parseRecipe';
import { useRef, useState } from 'react';
import { api } from '../../../shared/api/client';
import { AUTO_REFRESH, errorMessage, useApiMutation, useApiQuery } from '../../../shared/api/useApi';
import { useT } from '../../../shared/lib/useT';
import { Dialog } from '../../../shared/ui/dialog/Dialog';
import { Button } from '../../../shared/ui/Button';
import { QueryStatus } from '../../../shared/ui/QueryStatus';
import { ActionNote } from '../../../shared/ui/ActionNote';
import { FormDialog } from '../../../shared/ui/dialog/FormDialog';
import { RecipeEditor } from './recipe/RecipeEditor';
import { BuildHistory } from './BuildHistory';
import { ImageVersions } from './ImageVersions';
import styles from './RuntimeImages.module.css';

export function ImageDetail({ projectId, imageId, editable, admin, manageable, initialTab = 'versions', standalone = false, onClose }: { readonly projectId: string | undefined; readonly imageId: string; readonly editable: boolean; readonly admin: boolean; readonly manageable: boolean; readonly initialTab?: 'versions' | 'settings'; readonly standalone?: boolean; readonly onClose: () => void }) {
  const t = useT(), key = ['runtime-images', projectId, imageId];
  const image = useApiQuery([...key, 'detail'], () => api.runtimeImages.get(projectId, imageId), AUTO_REFRESH);
  const owned = admin && projectId === undefined;
  const [before, setBefore] = useState<string>(), [tab, setTab] = useState<string>(initialTab);
  const revisions = useApiQuery([...key, 'revisions', before], () => api.runtimeImages.revisions(projectId, imageId, { before, limit: 20 }), { ...AUTO_REFRESH, enabled: owned && editable });
  const [editing, setEditing] = useState(false), [draft, setDraft] = useState(''), [revisionId, setRevisionId] = useState('');
  const [uploading, setUploading] = useState(false);
  const [baseline, setBaseline] = useState('');
  const buildKey = useRef<{ revision: string; key: string } | undefined>(undefined);
  const save = useApiMutation(async () => api.runtimeImages.createRevision(projectId, imageId, parseRecipe(draft, t('images.invalidRecipe'))), { invalidate: [key], onSuccess: (revision) => { setBefore(undefined); setRevisionId(revision.id); setEditing(false); setDraft(''); } });
  const build = useApiMutation(() => {
    const revision = revisionId || revisions.data?.items[0]?.id;
    if (!revision) throw new Error(t('images.noRevision'));
    if (buildKey.current?.revision !== revision) buildKey.current = { revision, key: crypto.randomUUID() };
    return api.runtimeImages.startBuild(projectId, imageId, { revisionId: revision, requestKey: buildKey.current.key });
  }, { invalidate: [key], onSuccess: () => { buildKey.current = undefined; setTab('builds'); } });
  const content = <div className={styles.stack}>
    <QueryStatus isPending={image.isPending} error={image.error} />
    <p className={styles.note}>{t(owned ? 'images.detailHint' : 'images.sharedNote')}</p>
    {build.data ? <ActionNote tone="success">{t('images.buildAccepted', { id: build.data.id })}</ActionNote> : null}
    {!image.error && image.data ? <Tabs label={t('images.detail')} value={tab} onChange={setTab} items={[{ value: 'settings', label: t('images.manage') }, ...(owned && editable ? [{ value: 'recipe', label: t('images.recipeTab') }] : []), { value: 'versions', label: t('images.versions') }, ...(owned && editable ? [{ value: 'builds', label: t('images.buildTab') }, { value: 'grants', label: t('images.grants') }] : []), { value: 'history', label: t('images.history') }]}>
    {tab === 'recipe' && owned && editable ? <><p>{t('images.recipeWorkflow')}</p><div className={styles.row}>
      <FormField label={t('images.revision')}><select value={revisionId || revisions.data?.items[0]?.id || ''} onChange={(event) => setRevisionId(event.target.value)}>
        {revisionId && !revisions.data?.items.some((revision) => revision.id === revisionId) ? <option value={revisionId}>{revisionId}</option> : null}
        {revisions.data?.items.map((revision) => <option key={revision.id} value={revision.id}>{revision.revision} · {t(`images.usage.${revision.source.usage}`)} · {revision.commitSha?.slice(0, 12) ?? t(revision.source.kind === 'inline' ? 'images.sourceInline' : 'images.sourceExisting')}</option>)}
      </select></FormField>
      {before ? <Button onClick={() => { setBefore(undefined); setRevisionId(''); }}>{t('images.first')}</Button> : null}
      {revisions.data?.items.length === 20 ? <Button onClick={() => { setBefore(revisions.data!.items.at(-1)!.id); setRevisionId(''); }}>{t('images.next')}</Button> : null}
      {editable ? <><Button variant="primary" disabled={!image.data?.enabled || !revisions.data?.items.length || build.isPending || !!revisions.error} onClick={() => build.mutate()}>{t('images.build')}</Button><Button disabled={!image.data?.enabled} onClick={() => { if (!draft && revisions.data?.items[0]) { const current = revisions.data.items.find((r) => r.id === revisionId) ?? revisions.data.items[0]; const initial = JSON.stringify({ sourceProjectId: current.sourceProjectId, source: current.source, initializer: current.initializer, tools: current.tools }, null, 2); setBaseline(initial); setDraft(initial); } setEditing(true); }}>{t('images.editRecipe')}</Button></> : null}
    </div><QueryStatus isPending={revisions.isPending} error={revisions.error} />
    {revisions.data?.items[0] ? <RecipeSummary revision={revisions.data.items.find((r) => r.id === revisionId) ?? revisions.data.items[0]} /> : null}
    {build.error ? <ActionNote tone="error">{errorMessage(build.error)}</ActionNote> : null}
    </> : null}
      {tab === 'versions' ? <ImageVersions projectId={projectId} imageId={imageId} editable={editable} manageable={manageable} owned={owned} /> : null}
      {tab === 'builds' && owned ? <BuildHistory projectId={projectId} imageId={imageId} editable={editable} /> : null}
      {tab === 'history' ? <ImageHistory projectId={projectId} imageId={imageId} /> : null}
      {tab === 'grants' && owned && image.data ? <div className={styles.stack}><ImageVisibility image={image.data} /><ImageGrants imageId={imageId} /></div> : null}
      {tab === 'settings' && image.data ? <div className={styles.stack}><ImageMetadata projectId={projectId} image={image.data} editable={editable && owned} manageable={manageable && owned} /></div> : null}
    </Tabs> : null}
    {editing ? <FormDialog size="large" title={t('images.editRecipe')} submitLabel={t('images.saveRevision')} busy={save.isPending} submitDisabled={uploading} onClose={() => setEditing(false)} onSubmit={() => save.mutate()} error={save.error ? errorMessage(save.error) : undefined} dirty={draft !== baseline} onClear={() => setDraft(baseline)}>
      <p>{t('images.newRecipeHint')}</p><RecipeEditor projectId={projectId} value={draft} onChange={setDraft} onPendingChange={setUploading} />
    </FormDialog> : null}
  </div>;
  return standalone ? <CatalogPage title={image.data?.name ?? t('images.detail')} description={t('images.managementHint')}><ActionRow><Button onClick={onClose}>{t('images.backToCatalog')}</Button></ActionRow><Card>{content}</Card></CatalogPage> : <Dialog title={image.data?.name ?? t('images.detail')} size="large" initialFocus="dialog" onClose={onClose}>{content}</Dialog>;
}
