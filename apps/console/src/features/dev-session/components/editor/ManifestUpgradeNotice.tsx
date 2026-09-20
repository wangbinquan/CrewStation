import type { ReactElement } from 'react';
import { api } from '../../../../shared/api/client';
import { errorMessage, useApiMutation } from '../../../../shared/api/useApi';
import { useT } from '../../../../shared/lib/useT';
import { Button } from '../../../../shared/ui/Button';
import type { FileEditorHandle } from '../../hooks/useFileEditor';
import { PaneNotice } from '../PaneNotice';
import styles from './ManifestUpgradeNotice.module.css';

/** Preview starts from the visible draft; applying only changes that draft, with normal save CAS retained. */
export function ManifestUpgradeNotice({ serviceId, editor }: { readonly serviceId: string; readonly editor: FileEditorHandle }): ReactElement {
  const t = useT();
  const preview = useApiMutation(async (source: string) => ({ source, result: await api.services.previewManifestUpgrade(serviceId, source) }));
  const current = preview.data?.source === editor.draft;
  return <PaneNotice tone="warning">
    <p>{t('devSession.editor.upgradeHint')}</p>
    <Button disabled={editor.busy || preview.isPending || Boolean(editor.pendingAction)} onClick={() => preview.mutate(editor.draft)}>{t('devSession.editor.upgradePreview')}</Button>
    {preview.error ? <p role="alert">{errorMessage(preview.error)}</p> : null}
    {preview.data ? <>
      <details open><summary>{t('devSession.editor.upgradeChanges', { count: preview.data.result.changes.length })}</summary>
        <ul className={styles.changes}>{preview.data.result.changes.map((change) => <li key={change.path}><code>{change.path}</code><pre>{JSON.stringify(change.before)} → {JSON.stringify(change.after)}</pre></li>)}</ul>
      </details>
      {!current ? <p>{t('devSession.editor.upgradeStale')}</p> : null}
      <Button disabled={!current || editor.busy || Boolean(editor.pendingAction)} onClick={() => editor.change(preview.data!.result.content)}>{t('devSession.editor.upgradeApply')}</Button>
    </> : null}
  </PaneNotice>;
}
