import { Link, useLocation, useParams } from '@tanstack/react-router';
import type { ReactElement } from 'react';
import { useT } from '../../shared/lib/useT';
import { NavFrame } from './NavFrame';
import { ProjectNavSection } from './ProjectNavSection';
import { api } from '../../shared/api/client';
import { queryKeys } from '../../shared/api/queryKeys';
import { useApiQuery } from '../../shared/api/useApi';
import styles from './SideNav.module.css';

type AdminPagePath =
  | '/admin'
  | '/admin/users'
  | '/admin/compute'
  | '/admin/service-plans'
  | '/admin/task-profiles'
  | '/admin/capabilities'
  | '/admin/requests'
  | '/admin/egress'
  | '/admin/gateway';

interface AdminPageItem {
  readonly to: AdminPagePath;
  readonly labelKey: string;
  readonly exact?: boolean;
}

/** 管理空间左栏的顺序即 RFC-002 §2.1 的顺序；路径与 features/admin/routes.ts 一一对应。 */
const ADMIN_PAGES: readonly AdminPageItem[] = [
  { to: '/admin', labelKey: 'nav.admin.overview', exact: true },
  { to: '/admin/users', labelKey: 'nav.admin.users' },
  { to: '/admin/compute', labelKey: 'nav.admin.compute' },
  { to: '/admin/service-plans', labelKey: 'nav.admin.servicePlans' },
  { to: '/admin/task-profiles', labelKey: 'nav.admin.taskProfiles' },
  { to: '/admin/capabilities', labelKey: 'nav.admin.capabilities' },
  { to: '/admin/requests', labelKey: 'nav.admin.requests' },
  { to: '/admin/egress', labelKey: 'nav.admin.egress' },
  { to: '/admin/gateway', labelKey: 'nav.admin.gateway' },
];

export function AdminNav(): ReactElement {
  const t = useT();
  const { projectId } = useParams({ strict: false }), path = useLocation().pathname;
  const me = useApiQuery(queryKeys.me(), () => api.me.get());
  const inProject = path.startsWith('/admin/integrations/') && projectId && !me.error && me.data?.isAdmin === true;
  return (
    <NavFrame subtitleKey="app.adminSpace">
      {inProject ? <><Link to="/admin/capabilities" search={{ tab: 'integrations' }} className={styles.link}>{t('nav.admin.backToIntegrations')}</Link><ProjectNavSection projectId={projectId} space="admin" /></> : null}
      {inProject ? <details className={styles.globalTools}><summary>{t('nav.admin.section')}</summary><AdminGlobalLinks /></details> : <AdminGlobalLinks />}
    </NavFrame>
  );
}

function AdminGlobalLinks() {
  const t = useT();
  return <ul className={styles.list}>
    {ADMIN_PAGES.map((item) => <li key={item.to}><Link to={item.to} className={styles.link} activeProps={{ className: styles.linkActive }} activeOptions={{ exact: item.exact ?? false }}>{t(item.labelKey)}</Link></li>)}
  </ul>;
}
