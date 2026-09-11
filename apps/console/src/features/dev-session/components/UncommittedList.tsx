import type { ReactElement } from 'react';
import { useT } from '../../../shared/lib/useT';
import { PaneNotice } from './PaneNotice';
import styles from './UncommittedList.module.css';

/**
 * 发布预检失败（412）时容器里未提交的文件。
 * 平台不替用户提交，所以这里列出路径让他回终端处理，而不是弹一句“precondition failed”。
 */
export function UncommittedList({ paths }: { readonly paths: readonly string[] }): ReactElement {
  const t = useT();
  return (
    <div className={styles.block}>
      <PaneNotice tone="warning">{t('devSession.publish.uncommitted', { count: paths.length })}</PaneNotice>
      <ul className={styles.paths}>
        {paths.map((path) => (
          <li key={path}>
            <code>{path}</code>
          </li>
        ))}
      </ul>
      <p className={styles.hint}>{t('devSession.publish.uncommittedHint')}</p>
    </div>
  );
}
