import type { ReactElement, ReactNode } from 'react';
import { Stack } from './Stack';
import styles from './Card.module.css';

/**
 * 卡片里按钮的位置（2026-09-23 作者裁定，RFC-003 design §6）：
 * - 装列表的卡片：「新增／添加」这类针对整张列表的动作放 `extra`（标题行右侧），行内动作放在行末（紧凑尺寸）。
 * - 代表一个对象的卡片（版本、维护、会话、档位……）：针对这个对象的动作放 `actions`，即卡片底部一条操作条，靠左，
 *   主按钮在最左、危险动作在最后，标准尺寸。`extra` 只放状态角标。
 * `footer` 是灰色的补充说明，不放按钮。
 */
export interface CardProps {
  readonly title?: ReactNode;
  readonly extra?: ReactNode;
  /** 对象卡片的底部操作条。 */
  readonly actions?: ReactNode;
  readonly footer?: ReactNode;
  readonly className?: string;
  readonly compact?: boolean;
  /** 多个独立内容块共用间距；已有内部布局的卡片保持默认行为。 */
  readonly stacked?: boolean;
  readonly children: ReactNode;
}

export function Card({ title, extra, actions, footer, className, compact = false, stacked = false, children }: CardProps): ReactElement {
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
      {actions !== undefined && actions !== null && actions !== false ? <div className={styles.actions}>{actions}</div> : null}
      {footer !== undefined ? <footer className={styles.footer}>{footer}</footer> : null}
    </section>
  );
}
