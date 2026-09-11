import type { ReactElement } from 'react';
import { useT } from '../../shared/lib/useT';
import styles from './TopBar.module.css';

/** 当前用户占位：身份由网关在用户域注入，接入 cs-auth 后替换为真实用户。 */
export function CurrentUserChip(): ReactElement {
  const t = useT();
  return (
    <div className={styles.user} title={t('topBar.userHint')}>
      <span className={styles.avatar} aria-hidden="true">
        ?
      </span>
      <span className={styles.userName}>{t('topBar.userPlaceholder')}</span>
    </div>
  );
}
