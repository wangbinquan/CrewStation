import { useEffect, useRef, type ReactElement } from 'react';
import { useT } from '../../../../shared/lib/useT';
import { Button } from '../../../../shared/ui/Button';
import type { FileEditorHandle } from '../../hooks/useFileEditor';
import type { WorkspaceTree } from '../../hooks/useWorkspaceTree';
import { Pane } from '../Pane';
import { PaneNotice } from '../PaneNotice';
import { CodeEditor } from './CodeEditor';
import { FileTree } from './FileTree';
import { EditorDiscardPrompt } from './EditorDiscardPrompt';
import { ManifestUpgradeNotice } from './ManifestUpgradeNotice';
import styles from './EditorPane.module.css';

export interface EditorPaneProps {
  readonly serviceId?: string;
  readonly tree: WorkspaceTree;
  readonly editor: FileEditorHandle;
  readonly connected?: boolean;
}

function Toolbar({ editor, connected }: { readonly editor: FileEditorHandle; readonly connected: boolean }): ReactElement | null {
  const t = useT();
  if (editor.file === undefined) return null;
  return (
    <>
      <code className={styles.path}>{editor.file.path}</code>
      {editor.dirty ? <span className={styles.dirty}>{t('devSession.editor.dirty')}</span> : null}
      <Button variant="primary" disabled={!connected || !editor.dirty || editor.busy || Boolean(editor.pendingAction)} onClick={editor.save}>
        {editor.busy ? t('devSession.editor.saving') : t('devSession.editor.save')}
      </Button>
      <Button disabled={!connected || editor.busy || Boolean(editor.pendingAction)} onClick={editor.reload}>
        {t('devSession.editor.reload')}
      </Button>
      <Button disabled={editor.busy || Boolean(editor.pendingAction)} onClick={editor.close}>{t('devSession.editor.close')}</Button>
    </>
  );
}

function EditorNotice({ editor }: { readonly editor: FileEditorHandle }): ReactElement | null {
  const t = useT();
  const notice = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (editor.pendingAction) return;
    const element = notice.current;
    const target = editor.error !== undefined ? element : element?.querySelector<HTMLButtonElement>('button:last-child');
    target?.focus({ preventScroll: true });
    element?.scrollIntoView?.({ block: 'nearest' });
  }, [editor.conflict, editor.error, editor.pendingAction]);
  if (editor.pendingAction) return <EditorDiscardPrompt editor={editor} />;
  return <div ref={notice} tabIndex={-1}>
    {editor.conflict ? <PaneNotice tone="warning"><strong>{t('devSession.editor.conflict')}</strong> {t('devSession.editor.conflictHint')}
      <Button disabled={editor.busy} onClick={editor.reload}>{t('devSession.editor.conflictReload')}</Button>
      <Button disabled={editor.busy} onClick={editor.dismissConflict}>{t('devSession.editor.conflictKeep')}</Button>
    </PaneNotice> : null}
    {editor.error !== undefined ? <PaneNotice tone="warning">{editor.error}</PaneNotice> : null}
  </div>;
}

/** 编辑器：左树右编辑区，保存带 expectedVersion；磁盘上变了就提示重载，不覆盖。 */
export function EditorPane({ tree, editor, serviceId, connected = true }: EditorPaneProps): ReactElement {
  const t = useT();
  return (
    <Pane
      title={t('devSession.editor.title')}
      className={styles.pane}
      flush
      extra={<Toolbar editor={editor} connected={connected} />}
      notice={<>
        {serviceId && editor.file?.path === 'crewstation.yaml' && /crewstation\/v1/.test(editor.draft) ? <ManifestUpgradeNotice serviceId={serviceId} editor={editor} /> : null}
        {!connected ? <PaneNotice tone="warning">{t('devSession.editor.disconnected')}</PaneNotice> : null}
        {editor.pendingAction || editor.conflict || editor.error !== undefined ? <EditorNotice editor={editor} /> : null}
      </>}
    >
      <div className={styles.content}>
        <FileTree tree={tree} openPath={editor.file?.path} onOpen={editor.openFile} disabled={!connected || editor.busy || Boolean(editor.pendingAction)} />
        {editor.file === undefined ? (
          <p className={styles.placeholder}>{!connected ? t('devSession.editor.waitConnection') : tree.error ?? t('devSession.editor.placeholder')}</p>
        ) : (
          <CodeEditor file={editor.file} draft={editor.draft} onChange={editor.change} onSave={() => { if (connected) editor.save(); }} />
        )}
      </div>
    </Pane>
  );
}
