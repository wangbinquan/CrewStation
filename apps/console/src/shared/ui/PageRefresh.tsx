import type { ReactElement } from 'react';
import { useDateText } from '../lib/useDateText';
import { useT } from '../lib/useT';
import { Button } from './Button';
import styles from './PageRefresh.module.css';

export interface PageRefreshProps {
  /** 本页主要数据最近一次读到的时间；没有读到过就只显示刷新。 */
  readonly readAt?: string;
  readonly onRefresh: () => void;
  readonly refreshing?: boolean;
}

/** 页头右侧统一的「读取于 hh:mm ↻」：每页只此一处，卡片不再各自带刷新按钮（RFC-020 §6）。 */
export function PageRefresh({ readAt, onRefresh, refreshing = false }: PageRefreshProps): ReactElement {
  const t = useT(), date = useDateText();
  return (
    <span className={styles.refresh}>
      {readAt !== undefined ? <span className={styles.readAt}>{t('ui.readAt', { time: date(readAt) })}</span> : null}
      <Button variant="ghost" className={styles.button} disabled={refreshing} onClick={onRefresh}>{refreshing ? t('ui.refreshing') : t('ui.refresh')}</Button>
    </span>
  );
}
