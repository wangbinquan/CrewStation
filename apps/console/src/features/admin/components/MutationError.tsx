import type { ReactElement } from 'react';
import { errorMessage } from '../../../shared/api/useApi';
import { useT } from '../../../shared/lib/useT';
import { ActionNote } from '../../../shared/ui/ActionNote';
import styles from './MutationError.module.css';

export interface MutationErrorProps {
  readonly error: unknown;
  /** 失败文案的键，模板里用 {message} 承接服务端的 message。 */
  readonly messageKey: string;
}

/** 写操作失败时贴在分区顶部的一行；error 为空时不渲染。 */
export function MutationError({ error, messageKey }: MutationErrorProps): ReactElement | null {
  const t = useT();
  if (error === null || error === undefined) return null;
  // 外面包一层只为了和下面的列表拉开距离：ActionNote 自己不带外边距。
  return (
    <div className={styles.spaced}>
      <ActionNote tone="error">{t(messageKey, { message: errorMessage(error) })}</ActionNote>
    </div>
  );
}
