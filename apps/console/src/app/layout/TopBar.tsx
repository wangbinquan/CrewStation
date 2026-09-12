import { useLocation, useParams } from '@tanstack/react-router';
import type { ReactElement } from 'react';
import { useT } from '../../shared/lib/useT';
import { CurrentUserChip } from './CurrentUserChip';
import { LocaleSwitch } from './LocaleSwitch';
import { SpaceSwitch } from './SpaceSwitch';
import styles from './TopBar.module.css';

/** 顶栏：当前空间与位置、空间切换（仅管理员）、界面语言、当前用户。 */
export function TopBar(): ReactElement {
  const t = useT();
  const { projectId } = useParams({ strict: false });
  const inAdmin = useLocation().pathname.startsWith('/admin');
  return (
    <header className={styles.bar}>
      <div className={styles.context}>
        <span>{t(inAdmin ? 'app.adminSpace' : 'app.workbench')}</span>
        {!inAdmin && projectId !== undefined ? (
          <>
            <span className={styles.separator}>/</span>
            <span>{t('topBar.project', { projectId })}</span>
          </>
        ) : null}
      </div>
      <div className={styles.right}>
        <SpaceSwitch />
        <LocaleSwitch />
        <CurrentUserChip />
      </div>
    </header>
  );
}
