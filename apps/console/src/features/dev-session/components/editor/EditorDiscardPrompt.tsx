import { useEffect, useRef } from 'react';
import { useT } from '../../../../shared/lib/useT';
import { ConfirmationPanel } from '../../../../shared/ui/ConfirmationPanel';
import type { FileEditorHandle } from '../../hooks/useFileEditor';

/** 文件切换与重载共用明确的草稿放弃确认；确认读入失败仍保留原草稿。 */
export function EditorDiscardPrompt({ editor }: { readonly editor: FileEditorHandle }) {
  const t = useT(), panel = useRef<HTMLDivElement>(null), action = editor.pendingAction;
  useEffect(() => { if (action) panel.current?.querySelector<HTMLButtonElement>('button:last-child')?.focus(); }, [action]);
  if (!action) return null;
  return <div ref={panel}><ConfirmationPanel
    question={t(`devSession.editor.discard.${action.type}`, { path: editor.file?.path ?? '', target: action.type === 'open' ? action.path : '' })}
    hint={t('devSession.editor.discardHint')}
    confirmLabel={t('devSession.editor.discardConfirm')}
    cancelLabel={t('devSession.editor.conflictKeep')}
    busy={editor.busy}
    onConfirm={editor.confirmDiscard}
    onCancel={editor.cancelDiscard}
  /></div>;
}
