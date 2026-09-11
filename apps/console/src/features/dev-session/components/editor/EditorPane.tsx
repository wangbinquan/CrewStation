import type { ReactElement } from 'react';
import { useT } from '../../../../shared/lib/useT';
import { Button } from '../../../../shared/ui/Button';
import type { FileEditorHandle } from '../../hooks/useFileEditor';
import type { WorkspaceTree } from '../../hooks/useWorkspaceTree';
import { InlineConfirm } from '../InlineConfirm';
import { Pane } from '../Pane';
import { PaneNotice } from '../PaneNotice';
import { CodeEditor } from './CodeEditor';
import { FileTree } from './FileTree';
import styles from './EditorPane.module.css';

export interface EditorPaneProps {
  readonly tree: WorkspaceTree;
  readonly editor: FileEditorHandle;
}

function Toolbar({ editor }: { readonly editor: FileEditorHandle }): ReactElement | null {
  const t = useT();
  if (editor.file === undefined) return null;
  return (
    <>
      <code className={styles.path}>{editor.file.path}</code>
      {editor.dirty ? <span className={styles.dirty}>{t('devSession.editor.dirty')}</span> : null}
      <Button variant="primary" disabled={!editor.dirty || editor.busy} onClick={editor.save}>
        {editor.busy ? t('devSession.editor.saving') : t('devSession.editor.save')}
      </Button>
      <Button disabled={editor.busy} onClick={editor.reload}>
        {t('devSession.editor.reload')}
      </Button>
      <Button onClick={editor.close}>{t('devSession.editor.close')}</Button>
    </>
  );
}

function Footer({ editor }: { readonly editor: FileEditorHandle }): ReactElement | null {
  const t = useT();
  if (editor.conflict) {
    return (
      <InlineConfirm
        question={t('devSession.editor.conflict')}
        hint={t('devSession.editor.conflictHint')}
        confirmLabel={t('devSession.editor.conflictReload')}
        cancelLabel={t('devSession.editor.conflictKeep')}
        busy={editor.busy}
        onConfirm={editor.reload}
        onCancel={editor.dismissConflict}
      />
    );
  }
  if (editor.error !== undefined) return <PaneNotice tone="warning">{editor.error}</PaneNotice>;
  return null;
}

/** 编辑器：左树右编辑区，保存带 expectedVersion；磁盘上变了就提示重载，不覆盖。 */
export function EditorPane({ tree, editor }: EditorPaneProps): ReactElement {
  const t = useT();
  const footer = <Footer editor={editor} />;
  return (
    <Pane
      title={t('devSession.editor.title')}
      className={styles.pane}
      flush
      extra={<Toolbar editor={editor} />}
      footer={editor.conflict || editor.error !== undefined ? footer : undefined}
    >
      <FileTree tree={tree} openPath={editor.file?.path} onOpen={editor.openFile} />
      {editor.file === undefined ? (
        <p className={styles.placeholder}>{tree.error ?? t('devSession.editor.placeholder')}</p>
      ) : (
        <CodeEditor file={editor.file} draft={editor.draft} onChange={editor.change} onSave={editor.save} />
      )}
    </Pane>
  );
}
