import type { ReactElement, ReactNode } from 'react';
import { Stack } from './Stack';
import styles from './Card.module.css';

export interface CardProps {
  readonly title?: ReactNode;
  readonly extra?: ReactNode;
  readonly footer?: ReactNode;
  readonly className?: string;
  readonly compact?: boolean;
  /** 多个独立内容块共用间距；已有内部布局的卡片保持默认行为。 */
  readonly stacked?: boolean;
  readonly children: ReactNode;
}

export function Card({ title, extra, footer, className, compact = false, stacked = false, children }: CardProps): ReactElement {
  const Body = stacked ? Stack : 'div';
  return (
    <section className={[styles.card, compact && styles.compact, className].filter(Boolean).join(' ')}>
      {title !== undefined || extra !== undefined ? (
        <header className={styles.header}>
          <h2 className={styles.title}>{title}</h2>
          {extra !== undefined ? <div className={styles.extra}>{extra}</div> : null}
        </header>
      ) : null}
      <Body className={styles.body}>{children}</Body>
      {footer !== undefined ? <footer className={styles.footer}>{footer}</footer> : null}
    </section>
  );
}
