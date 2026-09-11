import type { ReactElement, ReactNode } from 'react';
import styles from './Card.module.css';

export interface CardProps {
  readonly title?: ReactNode;
  readonly extra?: ReactNode;
  readonly footer?: ReactNode;
  readonly className?: string;
  readonly children: ReactNode;
}

export function Card({ title, extra, footer, className, children }: CardProps): ReactElement {
  return (
    <section className={[styles.card, className].filter(Boolean).join(' ')}>
      {title !== undefined || extra !== undefined ? (
        <header className={styles.header}>
          <h2 className={styles.title}>{title}</h2>
          {extra !== undefined ? <div className={styles.extra}>{extra}</div> : null}
        </header>
      ) : null}
      <div className={styles.body}>{children}</div>
      {footer !== undefined ? <footer className={styles.footer}>{footer}</footer> : null}
    </section>
  );
}
