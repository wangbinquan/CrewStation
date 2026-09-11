import { useParams } from '@tanstack/react-router';
import type { ReactElement } from 'react';
import { useT } from '../../shared/lib/useT';
import { CurrentUserChip } from './CurrentUserChip';
import { LocaleSwitch } from './LocaleSwitch';
import styles from './TopBar.module.css';

/** 顶栏：当前位置（工作台／项目）、界面语言、当前用户。 */
export function TopBar(): ReactElement {
  const t = useT();
  const { projectId } = useParams({ strict: false });
  return (
    <header className={styles.bar}>
      <div className={styles.context}>
        <span>{t('app.workbench')}</span>
        {projectId !== undefined ? (
          <>
            <span className={styles.separator}>/</span>
            <span>{t('topBar.project', { projectId })}</span>
          </>
        ) : null}
      </div>
      <div className={styles.right}>
        <LocaleSwitch />
        <CurrentUserChip />
      </div>
    </header>
  );
}
