import { Link, useParams } from '@tanstack/react-router';
import type { ReactElement } from 'react';
import { useT } from '../../shared/lib/useT';
import { NavFrame } from './NavFrame';
import { ProjectNavSection } from './ProjectNavSection';
import styles from './SideNav.module.css';

/**
 * 租户空间的左栏：我的项目，进入某个项目后追加该项目的八个页面。
 * 这里没有、也不应该有任何平台管理入口——管理空间是独立的一级入口（RFC-002）。
 */
export function WorkbenchNav(): ReactElement {
  const t = useT();
  const { projectId } = useParams({ strict: false });
  return (
    <NavFrame subtitleKey="app.workbench">
      <div className={styles.section}>
        <div className={styles.sectionTitle}>{t('nav.myProjects')}</div>
        <ul className={styles.list}>
          <li>
            <Link to="/" className={styles.link} activeProps={{ className: styles.linkActive }} activeOptions={{ exact: true }}>
              {t('nav.projects')}
            </Link>
          </li>
        </ul>
      </div>
      {projectId !== undefined ? <ProjectNavSection projectId={projectId} /> : null}
    </NavFrame>
  );
}
