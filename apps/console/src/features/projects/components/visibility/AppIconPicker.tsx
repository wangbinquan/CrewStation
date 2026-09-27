import { useState } from 'react';
import type { AppIconLoadStatus } from '../../../../shared/ui/icons/AppIcon';
import type { AppIcon } from '@crewstation/contracts';
import { AppIcon as Icon } from '../../../../shared/ui/icons/AppIcon';
import { FormField } from '../../../../shared/ui/FormField';
import { useT } from '../../../../shared/lib/useT';
import type { usePresentationEditor } from '../../model/usePresentationEditor';
import styles from './Visibility.module.css';

export function AppIconPicker({ editor, origin }: { readonly editor: ReturnType<typeof usePresentationEditor>; readonly origin?: string }) {
  const [status, setStatus] = useState<AppIconLoadStatus>('loading');
  const t = useT(), { source, draft } = editor, locked = editor.save.isPending;
  return <div className={styles.stack}>
    <div className={styles.person}><Icon onStatus={setStatus} size="preview" projectId={editor.projectId} icon={draft.icon} source={source} applicationOrigin={origin} preview={editor.preview} /><Icon projectId={editor.projectId} icon={draft.icon} source={source} applicationOrigin={origin} preview={editor.preview} /><span>{t('projects.icon.preview')}</span></div>
    {status === 'fallback' && source.kind !== 'app' ? <p role="status" className={styles.status}>{t('projects.icon.loadFailed')}</p> : null}
    <FormField label={t('projects.icon.source')} hint={t('projects.icon.sourceHint')}>
      <select disabled={locked} value={source.kind} onChange={(event) => editor.chooseSource(event.target.value === 'url' ? { kind: 'url', url: '' } : event.target.value === 'upload' ? { kind: 'upload', revision: 0 } : { kind: 'app' })}>
        <option value="app">{t('projects.icon.app')}</option><option value="upload">{t('projects.icon.upload')}</option><option value="url">{t('projects.icon.url')}</option>
      </select>
    </FormField>
    {source.kind === 'url' ? <FormField label={t('projects.icon.url')} hint={t('projects.icon.urlHint')} error={editor.invalidUrl ? t('projects.icon.urlError') : undefined}>
      <input value={source.url} disabled={locked} maxLength={2048} onChange={(event) => editor.chooseSource({ kind: 'url', url: event.target.value })} />
    </FormField> : null}
    {source.kind === 'upload' ? <FormField label={t('projects.icon.file')} hint={editor.file?.name ?? t('projects.icon.fileHint')} error={editor.fileError ? t('projects.icon.fileError') : undefined}>
      <input type="file" accept="image/png,image/jpeg,image/webp" disabled={locked} onChange={(event) => { const file = event.target.files?.[0]; if (file) editor.chooseFile(file); }} />
    </FormField> : null}
    <FormField label={t('projects.icon.fallback')}>
      <select disabled={locked} value={draft.icon} onChange={(event) => editor.chooseIcon(event.target.value as AppIcon)}>
        {(['station', 'assistant', 'workflow', 'book', 'chart', 'spark'] as const).map((icon) => <option key={icon} value={icon}>{t(`projects.visibility.icon.${icon}`)}</option>)}
      </select>
    </FormField>
  </div>;
}
