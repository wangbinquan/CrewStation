import type { ReactElement, ReactNode } from 'react';
import styles from './Pane.module.css';

export interface PaneProps {
  readonly title: ReactNode;
  readonly extra?: ReactNode;
  readonly notice?: ReactNode;
  readonly footer?: ReactNode;
  /** 终端与编辑器自己占满，不要内边距。 */
  readonly flush?: boolean;
  /** 嵌在工具面板页签里：页签已是外框与标题，这里不再画卡片、不重复标题，只留工具栏。 */
  readonly embedded?: boolean;
  readonly className?: string;
  readonly children: ReactNode;
}

/**
 * 工作区面板：定高、标题栏常驻、内容区自己滚动。
 * 不用 shared/ui 的 Card：那里的内边距对终端与编辑器不合适，而定高是四个面板并排的前提。
 */
export function Pane({ title, extra, notice, footer, flush = false, embedded = false, className, children }: PaneProps): ReactElement {
  return (
    <section className={[styles.pane, embedded ? styles.embedded : undefined, className].filter(Boolean).join(' ')}>
      <header className={styles.header}>
        {embedded ? null : <h2 className={styles.title}>{title}</h2>}
        {extra !== undefined ? <div className={styles.extra}>{extra}</div> : null}
      </header>
      {notice !== undefined ? <div className={styles.notice}>{notice}</div> : null}
      <div className={flush ? styles.bodyFlush : styles.body}>{children}</div>
      {footer !== undefined ? <footer className={styles.footer}>{footer}</footer> : null}
    </section>
  );
}
