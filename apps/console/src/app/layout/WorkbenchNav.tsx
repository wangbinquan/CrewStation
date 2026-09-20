import { Link } from '@tanstack/react-router';
import type { ReactElement } from 'react';
import { useT } from '../../shared/lib/useT';
import { ProjectNavSection } from './ProjectNavSection';
import styles from './SideNav.module.css';

/**
 * 只在具体项目内显示六个项目入口；项目列表与新建页面由顶栏承接全局导航。
 * 这里没有、也不应该有任何平台管理入口——管理空间是独立的一级入口（RFC-002）。
 */
export function WorkbenchNav({ projectId }: { readonly projectId: string }): ReactElement {
  const t = useT();
  return (
    <nav className={styles.nav} aria-label={t('nav.aria')}>
      <ProjectNavSection projectId={projectId} backTo={<Link to="/projects" className={styles.back}>← {t('nav.projects')}</Link>} />
    </nav>
  );
}
