import type { ReactNode } from 'react';
import styles from './MetricTile.module.css';

/** 总览指标小卡片：标题、主数字和简短副文字，沿用集群状态的统一尺寸与外观。 */
export function MetricTile({ title, value, hint, children }: {
  readonly title: string;
  readonly value?: ReactNode;
  readonly hint?: string;
  readonly children?: ReactNode;
}) {
  return <article className={styles.tile} aria-label={title} title={hint}>
    <span className={styles.tileTitle}>{title}</span>
    {value !== undefined ? <span className={styles.hero}>{value}</span> : null}
    {children}
  </article>;
}
