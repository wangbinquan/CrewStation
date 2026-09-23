import { useT } from '../../../../shared/lib/useT';
import { ConfirmationDialog } from '../../../../shared/ui/dialog/ConfirmationDialog';
import type { FileEditorHandle } from '../../hooks/useFileEditor';

/**
 * 文件切换、重载与关闭共用明确的草稿放弃确认；确认读入失败仍保留原草稿。
 * 2026-09-23 起是确认弹窗，默认聚焦「继续编辑」（保留草稿）。
 */
export function EditorDiscardPrompt({ editor }: { readonly editor: FileEditorHandle }) {
  const t = useT(), action = editor.pendingAction;
  if (!action) return null;
  return <ConfirmationDialog
    question={t(`devSession.editor.discard.${action.type}`, { path: editor.file?.path ?? '', target: action.type === 'open' ? action.path : '' })}
    hint={t('devSession.editor.discardHint')}
    confirmLabel={t('devSession.editor.discardConfirm')}
    cancelLabel={t('devSession.editor.conflictKeep')}
    focus="cancel"
    busy={editor.busy}
    onConfirm={editor.confirmDiscard}
    onCancel={editor.cancelDiscard}
  />;
}
