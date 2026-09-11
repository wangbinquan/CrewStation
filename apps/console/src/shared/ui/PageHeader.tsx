import type { ReactElement, ReactNode } from 'react';
import styles from './PageHeader.module.css';

export interface PageHeaderProps {
  readonly title: string;
  /** 一行或多行说明；每一行渲染成一个段落。 */
  readonly description?: string | readonly string[];
  readonly actions?: ReactNode;
}

export function PageHeader({ title, description, actions }: PageHeaderProps): ReactElement {
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
      </div>
      {actions !== undefined ? <div className={styles.actions}>{actions}</div> : null}
    </header>
  );
}
