import type { ReactElement, ReactNode } from 'react';
import styles from './ActionNote.module.css';

export type ActionNoteTone = 'error' | 'success' | 'neutral';

/** 写操作的结果提示：失败用 alert 让读屏播报，成功与说明只是普通段落。 */
export function ActionNote({ tone, children }: { readonly tone: ActionNoteTone; readonly children: ReactNode }): ReactElement {
  return (
    <p className={[styles.note, styles[tone]].join(' ')} role={tone === 'error' ? 'alert' : 'status'}>
      {children}
    </p>
  );
}
