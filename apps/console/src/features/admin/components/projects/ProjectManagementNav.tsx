import { Link } from '@tanstack/react-router';
import { useT } from '../../../../shared/lib/useT';
import styles from './ProjectManagementNav.module.css';

export function ProjectManagementNav() {
  const t = useT();
  return <nav className={styles.nav} aria-label={t('nav.admin.projects')}>
    <Link to="/admin/projects" activeOptions={{ exact: true }} activeProps={{ className: styles.active }}>{t('admin.resources.projectList')}</Link>
    <Link to="/admin/projects/resource-templates" search={{ kind: 'service' }} activeOptions={{ includeSearch: false }} activeProps={{ className: styles.active }}>{t('admin.resources.templates')}</Link>
  </nav>;
}
