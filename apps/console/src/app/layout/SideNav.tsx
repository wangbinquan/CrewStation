import { Link, useParams } from '@tanstack/react-router';
import type { ReactElement } from 'react';
import { useT } from '../../shared/lib/useT';
import { ProjectNavSection } from './ProjectNavSection';
import styles from './SideNav.module.css';

/** 左侧导航：平台级入口（项目、管理员）；进入某个项目后追加该项目的页面入口。 */
export function SideNav(): ReactElement {
  const t = useT();
  const { projectId } = useParams({ strict: false });
  return (
    <nav className={styles.nav} aria-label={t('nav.aria')}>
      <div className={styles.brand}>
        <span className={styles.brandName}>{t('app.brand')}</span>
        <span className={styles.brandSub}>{t('app.workbench')}</span>
      </div>
      <div className={styles.section}>
        <div className={styles.sectionTitle}>{t('nav.platform')}</div>
        <ul className={styles.list}>
          <li>
            <Link to="/" className={styles.link} activeProps={{ className: styles.linkActive }} activeOptions={{ exact: true }}>
              {t('nav.projects')}
            </Link>
          </li>
          <li>
            <Link to="/admin" className={styles.link} activeProps={{ className: styles.linkActive }}>
              {t('nav.admin')}
            </Link>
          </li>
        </ul>
      </div>
      {projectId !== undefined ? <ProjectNavSection projectId={projectId} /> : null}
    </nav>
  );
}
