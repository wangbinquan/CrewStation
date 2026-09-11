import type { ReactElement } from 'react';
import { useT } from '../../../shared/lib/useT';
import { Button } from '../../../shared/ui/Button';
import styles from './LogPager.module.css';

export interface LogPagerProps {
  readonly hasOlder: boolean;
  readonly hasNewer: boolean;
  readonly follow: boolean;
  readonly onOlder: () => void;
  readonly onNewer: () => void;
}

/** 翻页只在不跟随时可用：向前翻用服务端给的 nextCursor，回退是弹出游标栈。 */
export function LogPager({ hasOlder, hasNewer, follow, onOlder, onNewer }: LogPagerProps): ReactElement {
  const t = useT();
  return (
    <div className={styles.pager}>
      <Button disabled={follow || !hasOlder} onClick={onOlder}>
        {t('logs.pager.older')}
      </Button>
      <Button disabled={!hasNewer} onClick={onNewer}>
        {hasNewer ? t('logs.pager.newer') : t('logs.pager.newest')}
      </Button>
      {follow ? <span className={styles.hint}>{t('logs.pager.followingHint')}</span> : null}
    </div>
  );
}
