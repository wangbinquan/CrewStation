import type { ReactElement, ReactNode } from 'react';
import styles from './PageHeader.module.css';

export interface PageHeaderProps {
  readonly title: string;
  /** 一行或多行说明；每一行渲染成一个段落。 */
  readonly description?: string | readonly string[];
  /** 标题下的元数据行（标识、状态、链接），由页面自己排版。 */
  readonly meta?: ReactNode;
  /** 本页的主动作（标准尺寸，主按钮排最左）；页面数据自动重读，页头不放刷新按钮（2026-09-23 裁定）。 */
  readonly actions?: ReactNode;
}

export function PageHeader({ title, description, meta, actions }: PageHeaderProps): ReactElement {
  const lines = description === undefined ? [] : typeof description === 'string' ? [description] : description;
  return (
    <header className={styles.header}>
      <div className={styles.text}>
        <h1 className={styles.title}>{title}</h1>
        {lines.map((line) => (
          <p key={line} className={styles.line}>
            {line}
          </p>
        ))}
        {meta !== undefined ? <div className={styles.meta}>{meta}</div> : null}
      </div>
      {actions !== undefined ? <div className={styles.actions}>{actions}</div> : null}
    </header>
  );
}
