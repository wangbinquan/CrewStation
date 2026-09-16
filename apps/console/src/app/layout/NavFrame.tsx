import type { ReactElement, ReactNode } from 'react';
import { useT } from '../../shared/lib/useT';
import styles from './SideNav.module.css';

export interface NavFrameProps {
  /** 空间名：工作台／平台管理。 */
  readonly subtitleKey: string;
  /** 空间名下的一句说明；项目内不重复显示。 */
  readonly hintKey?: string;
  readonly children: ReactNode;
}

/** 两套左栏共用的外框：空间名＋一句说明，再是各分区。样式只有这一份，两个空间不会各自漂移。 */
export function NavFrame({ subtitleKey, hintKey, children }: NavFrameProps): ReactElement {
  const t = useT();
  return (
    <nav className={styles.nav} aria-label={t('nav.aria')}>
      <div className={styles.brand}>
        <span className={styles.brandSub}>{t(subtitleKey)}</span>
        {hintKey ? <span className={styles.brandHint}>{t(hintKey)}</span> : null}
      </div>
      {children}
    </nav>
  );
}
