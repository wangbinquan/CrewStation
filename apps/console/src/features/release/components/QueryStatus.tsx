import type { ReactElement } from 'react';
import { errorMessage } from '../../../shared/api/useApi';
import { useT } from '../../../shared/lib/useT';
import styles from './QueryStatus.module.css';

export interface QueryStatusProps {
  readonly isPending: boolean;
  readonly error: unknown;
  readonly loadingKey: string;
  /** 失败文案的键，模板里用 {message} 承接服务端的 message。 */
  readonly errorKey: string;
}

/** 读操作的加载与失败提示；两者都没有时不占位置。 */
export function QueryStatus({ isPending, error, loadingKey, errorKey }: QueryStatusProps): ReactElement | null {
  const t = useT();
  if (error !== null && error !== undefined) {
    return (
      <p className={styles.error} role="alert">
        {t(errorKey, { message: errorMessage(error) })}
      </p>
    );
  }
  return isPending ? <p className={styles.hint}>{t(loadingKey)}</p> : null;
}
