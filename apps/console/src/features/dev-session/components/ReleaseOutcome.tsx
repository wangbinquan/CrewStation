import type { ReactElement } from 'react';
import type { ReleaseDevSessionResult } from '@crewstation/api-client';
import { useT } from '../../../shared/lib/useT';
import { PaneNotice } from './PaneNotice';
import styles from './ReleaseOutcome.module.css';

/**
 * 释放结果。
 * 容器里还没推上去的提交随容器一起消失，所以这条提示在会话消失之后仍要留在页面上。
 */
export function ReleaseOutcome({ result }: { readonly result: ReleaseDevSessionResult }): ReactElement {
  const t = useT();
  const { unpushed, workspace } = result;
  const count = workspace?.status === 'ready' && workspace.unpushed.status === 'ready' ? workspace.unpushed.count : unpushed?.length;
  return (
    <div className={styles.outcome}>
      <PaneNotice tone={count === undefined || count > 0 ? 'warning' : 'info'}>
        {count === undefined ? t('devSession.release.unknownDone') : count > 0 ? t('devSession.release.unpushed', { count }) : t('devSession.release.done')}
      </PaneNotice>
      {workspace?.status === 'ready' && workspace.uncommittedCount > 0 ? <PaneNotice tone="warning">{t('devSession.release.dirtyDone', { count: workspace.uncommittedCount })}</PaneNotice> : null}
      {unpushed !== null && unpushed.length > 0 ? (
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
