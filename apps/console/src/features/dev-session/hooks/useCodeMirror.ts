import { EditorState } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import { useEffect, useRef } from 'react';
import type { RefObject } from 'react';
import { languageExtension } from '../model/editorLanguage';
import { createEditorSetup } from '../model/editorExtensions';

export interface CodeMirrorOptions {
  /** 变化即表示“换了内容来源”（打开别的文件或重新载入），此时整体替换文档；保存不改它。 */
  readonly documentKey: string;
  readonly doc: string;
  readonly path: string;
  readonly onChange: (doc: string) => void;
  readonly onSave: () => void;
}

/** 在给定容器里挂一个 CodeMirror 视图并在卸载时销毁；视图只建一次，内容与语言按 documentKey 热替换。 */
export function useCodeMirror(containerRef: RefObject<HTMLDivElement | null>, options: CodeMirrorOptions): void {
  const viewRef = useRef<EditorView | null>(null);
  const languageRef = useRef<ReturnType<typeof createEditorSetup>['language'] | null>(null);
  const optionsRef = useRef(options);

  useEffect(() => {
    optionsRef.current = options;
  }, [options]);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const initial = optionsRef.current;
    const setup = createEditorSetup(initial.path, () => optionsRef.current);
    const view = new EditorView({ parent: container, state: EditorState.create({ doc: initial.doc, extensions: setup.extensions }) });
    viewRef.current = view;
    languageRef.current = setup.language;
    return () => {
      viewRef.current = null;
      languageRef.current = null;
      view.destroy();
    };
  }, [containerRef]);

  useEffect(() => {
    const view = viewRef.current;
    const language = languageRef.current;
    if (!view || !language) return;
    const { doc, path } = optionsRef.current;
    view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: doc }, effects: language.reconfigure(languageExtension(path)) });
  }, [options.documentKey]);
}
