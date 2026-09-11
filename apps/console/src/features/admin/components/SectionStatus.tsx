import type { ReactElement } from 'react';
import { errorMessage } from '../../../shared/api/useApi';
import { useT } from '../../../shared/lib/useT';
import { EmptyState } from '../../../shared/ui/EmptyState';
import styles from './SectionStatus.module.css';

export interface SectionStatusProps {
  readonly isPending: boolean;
  readonly error: unknown;
  readonly isEmpty: boolean;
  readonly emptyTitle: string;
  readonly emptyDescription?: string;
}

/** 各分区列表的载入中／失败／为空三态；有数据时返回 null，由调用方接着渲染表格。 */
export function SectionStatus({ isPending, error, isEmpty, emptyTitle, emptyDescription }: SectionStatusProps): ReactElement | null {
  const t = useT();
  if (isPending) return <p className={styles.hint}>{t('admin.status.loading')}</p>;
  if (error !== null && error !== undefined) {
    return (
      <p className={styles.error} role="alert">
        {t('admin.status.error', { message: errorMessage(error) })}
      </p>
    );
  }
  if (isEmpty) return <EmptyState title={emptyTitle} description={emptyDescription} />;
  return null;
}

/** 写操作失败时贴在分区顶部的一行；error 为空时不渲染。 */
export function MutationError({ error, messageKey }: { readonly error: unknown; readonly messageKey: string }): ReactElement | null {
  const t = useT();
  if (error === null || error === undefined) return null;
  return (
    <p className={styles.mutationError} role="alert">
      {t(messageKey, { message: errorMessage(error) })}
    </p>
  );
}
