import { Link, useParams, useRouterState } from '@tanstack/react-router';
import type { ReactElement } from 'react';
import { useT } from '../../shared/lib/useT';
import { NavFrame } from './NavFrame';
import { ProjectNavSection } from './ProjectNavSection';
import styles from './SideNav.module.css';

/**
 * 工作台全局为应用市场与开发项目；市场详情不会获得项目内部导航。
 * 这里没有、也不应该有任何平台管理入口——管理空间是独立的一级入口（RFC-002）。
 */
export function WorkbenchNav(): ReactElement {
  const t = useT();
  const { projectId } = useParams({ strict: false });
  const path = useRouterState({ select: (state) => state.location.pathname });
  const inProject = path.startsWith('/projects/');
  return (
    <NavFrame subtitleKey="app.workbench">
      <div className={styles.section}>
        <ul className={styles.list}>
          <li><Link to="/market" className={[styles.link, (path === '/' || path.startsWith('/market')) && styles.linkActive].filter(Boolean).join(' ')}>{t('nav.market')}</Link></li>
          <li>
            <Link to="/projects" className={styles.link} activeProps={{ className: styles.linkActive }} activeOptions={{ exact: true }}>
              {t('nav.projects')}
            </Link>
          </li>
        </ul>
      </div>
      {inProject && projectId !== undefined ? <ProjectNavSection projectId={projectId} /> : null}
    </NavFrame>
  );
}
