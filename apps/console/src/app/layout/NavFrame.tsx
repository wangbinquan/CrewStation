import type { ReactElement, ReactNode } from 'react';
import { useT } from '../../shared/lib/useT';
import styles from './SideNav.module.css';

export interface NavFrameProps {
  /** 品牌下方的一行小字：哪个空间。 */
  readonly subtitleKey: string;
  readonly children: ReactNode;
}

/** 两套左栏共用的外框：品牌行 ＋ 分区容器。样式只有这一份，两个空间不会各自漂移。 */
export function NavFrame({ subtitleKey, children }: NavFrameProps): ReactElement {
  const t = useT();
  return (
    <nav className={styles.nav} aria-label={t('nav.aria')}>
      <div className={styles.brand}>
        <span className={styles.brandSub}>{t(subtitleKey)}</span>
      </div>
      {children}
    </nav>
  );
}
