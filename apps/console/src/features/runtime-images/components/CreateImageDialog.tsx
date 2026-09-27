import styles from './RuntimeImages.module.css';
import { CreateRuntimeImageRevisionSchema } from '@crewstation/contracts';
import { useRef, useState } from 'react';
import { api } from '../../../shared/api/client';
import { errorMessage, isApiClientError, useApiMutation } from '../../../shared/api/useApi';
import { useT } from '../../../shared/lib/useT';
import { FormField } from '../../../shared/ui/FormField';
import { FormDialog } from '../../../shared/ui/dialog/FormDialog';
import { revisionDraft } from '../model/imageDraft';
import { RecipeEditor } from './RecipeEditor';

export function CreateImageDialog({ projectId, open, onClose, onCreated }: { readonly projectId: string | undefined; readonly open: boolean; readonly onClose: () => void; readonly onCreated: (id: string) => void }) {
  const t = useT(), [name, setName] = useState(''), [description, setDescription] = useState(''), [draft, setDraft] = useState(revisionDraft);
  const [defaultVisible, setDefaultVisible] = useState(false);
  const [locked, setLocked] = useState(false), [start, setStart] = useState(true), request = useRef<{ content: string; key: string } | undefined>(undefined);
  const [accepted, setAccepted] = useState<Awaited<ReturnType<typeof api.runtimeImages.createSetup>>>();
  const create = useApiMutation(async () => {
    const recipe = CreateRuntimeImageRevisionSchema.parse(JSON.parse(draft)), content = JSON.stringify({ name: name.trim(), description, defaultVisible, recipe });
    if (request.current?.content !== content) request.current = { content, key: crypto.randomUUID() };
    setLocked(true);
    const result = accepted ?? await api.runtimeImages.createSetup(projectId, { name: name.trim(), description, defaultVisible, recipe, requestKey: request.current.key }).catch((error: unknown) => {
      if (isApiClientError(error) && error.status >= 400 && error.status < 500 && ![408, 429].includes(error.status)) setLocked(false);
      throw error;
    });
    setAccepted(result);
    if (start) await api.runtimeImages.startBuild(projectId, result.image.id, { revisionId: result.revision.id, requestKey: `first:${request.current.key}` });
    return result;
  }, { invalidate: [['runtime-images']], onSuccess: (result) => { onCreated(result.image.id); setAccepted(undefined); setLocked(false); request.current = undefined; setName(''); setDescription(''); setDefaultVisible(false); setDraft(revisionDraft()); } });
  if (!open) return null;
  return <FormDialog title={t('images.add')} submitLabel={t(start ? 'images.createAndBuild' : 'images.saveSetup')} busy={create.isPending} submitDisabled={!name.trim()}
    onClose={() => { if (accepted) { onCreated(accepted.image.id); setAccepted(undefined); setLocked(false); request.current = undefined; setName(''); setDescription(''); setDefaultVisible(false); setDraft(revisionDraft()); create.reset(); } else onClose(); }} onSubmit={() => create.mutate()}
    error={create.error ? `${accepted ? t('images.savedBuildFailed') + ' ' : locked ? t('images.createUnconfirmed') + ' ' : ''}${errorMessage(create.error)}` : undefined}>
    <p>{t('images.createHint')}</p>
    <fieldset className={styles.formFields} disabled={create.isPending || locked || !!accepted}>
      <FormField label={t('images.name')}><input value={name} maxLength={80} placeholder={t('images.nameExample')} onChange={(e) => setName(e.target.value)} /></FormField>
      <FormField label={t('images.description')}><input value={description} maxLength={1000} placeholder={t('images.descriptionExample')} onChange={(e) => setDescription(e.target.value)} /></FormField>
      <FormField label={t('images.defaultVisibility')} hint={t('images.defaultVisibilityHint')}><select value={String(defaultVisible)} onChange={(event) => setDefaultVisible(event.target.value === 'true')}><option value="false">{t('images.defaultHidden')}</option><option value="true">{t('images.defaultVisible')}</option></select></FormField>
      <RecipeEditor projectId={projectId} value={draft} onChange={setDraft} />
    </fieldset>
    <label><input type="checkbox" checked={start} onChange={(e) => setStart(e.target.checked)} /> {t('images.buildAfterSave')}</label>
  </FormDialog>;
}
