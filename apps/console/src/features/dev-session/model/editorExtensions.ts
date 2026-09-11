import { defaultKeymap, history, historyKeymap, indentWithTab } from '@codemirror/commands';
import { Compartment } from '@codemirror/state';
import type { Extension } from '@codemirror/state';
import { EditorView, drawSelection, highlightActiveLine, highlightActiveLineGutter, keymap, lineNumbers } from '@codemirror/view';
import { languageExtension } from './editorLanguage';

export interface EditorCallbacks {
  readonly onChange: (doc: string) => void;
  readonly onSave: () => void;
}

/** CodeMirror 的 theme 生成普通样式表，因此可以直接写 var()：深浅色跟着主题令牌走。 */
const THEME = EditorView.theme({
  '&': { backgroundColor: 'var(--cs-color-surface)', color: 'var(--cs-color-text)', height: '100%' },
  '.cm-content': { fontFamily: 'var(--cs-font-mono)', fontSize: '13px' },
  '.cm-gutters': { backgroundColor: 'var(--cs-color-surface-muted)', color: 'var(--cs-color-text-muted)', border: 'none' },
  '.cm-activeLine': { backgroundColor: 'var(--cs-color-surface-muted)' },
  '.cm-activeLineGutter': { backgroundColor: 'var(--cs-color-surface-muted)' },
  '&.cm-focused': { outline: 'none' },
});

export interface EditorSetup {
  readonly extensions: Extension[];
  /** 换文件时用它热替换语言，不必重建整个视图。 */
  readonly language: Compartment;
}

/**
 * 回调用取值函数传入：视图只建一次，而保存与变更的处理函数每次渲染都是新的。
 * Mod-s 拦下浏览器的保存对话框，改成写回容器。
 */
export function createEditorSetup(path: string, callbacks: () => EditorCallbacks): EditorSetup {
  const language = new Compartment();
  const save = {
    key: 'Mod-s',
    preventDefault: true,
    run: (): boolean => {
      callbacks().onSave();
      return true;
    },
  };
  return {
    language,
    extensions: [
      lineNumbers(),
      highlightActiveLine(),
      highlightActiveLineGutter(),
      drawSelection(),
      history(),
      keymap.of([save, indentWithTab, ...defaultKeymap, ...historyKeymap]),
      language.of(languageExtension(path)),
      EditorView.lineWrapping,
      EditorView.updateListener.of((update) => {
        if (update.docChanged) callbacks().onChange(update.state.doc.toString());
      }),
      THEME,
    ],
  };
}
