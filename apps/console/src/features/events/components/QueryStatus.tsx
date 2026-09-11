import type { ReactElement } from 'react';
import { errorMessage } from '../../../shared/api/useApi';
import { useT } from '../../../shared/lib/useT';
import { EmptyState } from '../../../shared/ui/EmptyState';
import styles from './QueryStatus.module.css';

export interface QueryStatusProps {
  readonly isPending: boolean;
  readonly error: unknown;
  readonly isEmpty: boolean;
  readonly emptyTitle: string;
  readonly emptyDescription?: string;
}

/**
 * 列表的载入中／失败／为空三态；有数据时返回 null，由调用方接着渲染表格。
 * 事件相关接口未就绪时服务端回 404，这里按普通读取失败展示，不做特判。
 */
export function QueryStatus({ isPending, error, isEmpty, emptyTitle, emptyDescription }: QueryStatusProps): ReactElement | null {
  const t = useT();
  if (isPending) return <p className={styles.hint}>{t('events.status.loading')}</p>;
  if (error !== null && error !== undefined) {
    return (
      <p className={styles.error} role="alert">
        {t('events.status.error', { message: errorMessage(error) })}
      </p>
    );
  }
  if (isEmpty) return <EmptyState title={emptyTitle} description={emptyDescription} />;
  return null;
}
