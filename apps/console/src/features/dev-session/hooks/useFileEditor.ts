import { useEffect, useMemo, useSyncExternalStore } from 'react';
import { FileEditorStore } from '../model/editor/fileEditorStore';
import type { EditorDiscardAction, EditorFile } from '../model/editor/fileEditorStore';
import type { TaskStreamChannel } from './useTaskStream';

export type { EditorFile } from '../model/editor/fileEditorStore';

export interface FileEditorHandle {
  readonly file: EditorFile | undefined;
  readonly draft: string;
  readonly dirty: boolean;
  readonly busy: boolean;
  /** 磁盘上的版本与打开时不同：提示重新载入，绝不覆盖。 */
  readonly conflict: boolean;
  readonly error: string | undefined;
  readonly pendingAction: EditorDiscardAction | undefined;
  readonly confirmDiscard: () => void;
  readonly cancelDiscard: () => void;
  readonly openFile: (path: string) => void;
  readonly change: (next: string) => void;
  readonly save: () => void;
  readonly reload: () => void;
  /** 先不重载、继续编辑：只收起冲突提示，保存仍会被 expectedVersion 挡住。 */
  readonly dismissConflict: () => void;
  readonly close: () => void;
}

/** 单文件编辑：读入、改、按 expectedVersion 写回；冲突只提示不覆盖。 */
export function useFileEditor(channel: TaskStreamChannel): FileEditorHandle {
  const store = useMemo(() => new FileEditorStore(channel), [channel]);
  useEffect(() => { store.activate(); return store.deactivate; }, [store]);
  const state = useSyncExternalStore(store.subscribe, store.getSnapshot);
  return {
    ...state, dirty: state.draft !== state.baseline, busy: Boolean(state.operation),
    openFile: store.openFile, change: store.change, save: store.save, reload: store.reload,
    dismissConflict: store.dismissConflict, close: store.close,
    confirmDiscard: store.confirmDiscard, cancelDiscard: store.cancelDiscard,
  };
}
