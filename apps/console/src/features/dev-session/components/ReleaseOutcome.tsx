import type { ReactElement } from 'react';
import { useT } from '../../../shared/lib/useT';
import { PaneNotice } from './PaneNotice';
import styles from './ReleaseOutcome.module.css';

/**
 * 释放结果。
 * 容器里还没推上去的提交随容器一起消失，所以这条提示在会话消失之后仍要留在页面上。
 */
export function ReleaseOutcome({ unpushed }: { readonly unpushed: readonly string[] }): ReactElement {
  const t = useT();
  return (
    <div className={styles.outcome}>
      <PaneNotice tone={unpushed.length > 0 ? 'warning' : 'info'}>
        {unpushed.length > 0 ? t('devSession.release.unpushed', { count: unpushed.length }) : t('devSession.release.done')}
      </PaneNotice>
      {unpushed.length > 0 ? (
        <ul className={styles.commits}>
          {unpushed.map((commit) => (
            <li key={commit}>
              <code>{commit}</code>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
