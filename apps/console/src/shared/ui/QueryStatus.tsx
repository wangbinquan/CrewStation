import type { ReactElement } from 'react';
import { errorMessage } from '../api/useApi';
import { useT } from '../lib/useT';
import { EmptyState } from './EmptyState';
import styles from './QueryStatus.module.css';

export interface QueryStatusProps {
  readonly isPending: boolean;
  readonly error: unknown;
  /** 载入文案的键；不给就用通用的 ui.status.loading。 */
  readonly loadingKey?: string;
  /** 失败文案的键，模板里用 {message} 承接服务端的 message；不给就用通用的 ui.status.error。 */
  readonly errorKey?: string;
  /** 只有同时给了 emptyTitle 才渲染空态，否则由调用方自己处理“有数据但为零条”。 */
  readonly isEmpty?: boolean;
  readonly emptyTitle?: string;
  readonly emptyDescription?: string;
}

/** 读操作的载入中／失败／为空三态；都不成立时返回 null，由调用方接着渲染内容。 */
export function QueryStatus({
  isPending,
  error,
  loadingKey = 'ui.status.loading',
  errorKey = 'ui.status.error',
  isEmpty = false,
  emptyTitle,
  emptyDescription,
}: QueryStatusProps): ReactElement | null {
  const t = useT();
  // data-query-state 让外层容器（useHeldHeight）看得见这里正在载入，换查询时先撑住高度再等回执。
  if (isPending) return <p className={styles.hint} data-query-state="pending">{t(loadingKey)}</p>;
  if (error !== null && error !== undefined) {
    return (
      <p className={styles.error} role="alert">
        {t(errorKey, { message: errorMessage(error) })}
      </p>
    );
  }
  if (isEmpty && emptyTitle !== undefined) return <EmptyState title={emptyTitle} description={emptyDescription} />;
  return null;
}
