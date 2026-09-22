import type { ReactElement, ReactNode } from 'react';
import { PageRefresh } from './PageRefresh';
import type { PageRefreshProps } from './PageRefresh';
import styles from './PageHeader.module.css';

export interface PageHeaderProps {
  readonly title: string;
  /** 一行或多行说明；每一行渲染成一个段落。 */
  readonly description?: string | readonly string[];
  /** 标题下的元数据行（标识、状态、链接），由页面自己排版。 */
  readonly meta?: ReactNode;
  readonly actions?: ReactNode;
  /** 页头右侧的「读取于 ↻」；给了就是本页唯一的刷新入口。 */
  readonly refresh?: PageRefreshProps;
}

export function PageHeader({ title, description, meta, actions, refresh }: PageHeaderProps): ReactElement {
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
      {actions !== undefined || refresh !== undefined ? <div className={styles.actions}>{actions}{refresh !== undefined ? <PageRefresh {...refresh} /> : null}</div> : null}
    </header>
  );
}
