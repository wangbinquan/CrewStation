import { useRef } from 'react';
import type { ReactElement } from 'react';
import { useCodeMirror } from '../../hooks/useCodeMirror';
import type { EditorFile } from '../../hooks/useFileEditor';
import styles from './CodeEditor.module.css';

export interface CodeEditorProps {
  readonly file: EditorFile;
  readonly draft: string;
  readonly onChange: (doc: string) => void;
  readonly onSave: () => void;
}

/**
 * CodeMirror 挂载点。只有打开了文件才渲染它：视图随组件挂载建立、卸载销毁，
 * 换文件由 documentKey 触发文档替换，不重建视图。
 */
export function CodeEditor({ file, draft, onChange, onSave }: CodeEditorProps): ReactElement {
  const containerRef = useRef<HTMLDivElement | null>(null);
  useCodeMirror(containerRef, { documentKey: `${file.path}:${file.revision}`, doc: draft, path: file.path, onChange, onSave });
  return <div className={styles.editor} ref={containerRef} />;
}
