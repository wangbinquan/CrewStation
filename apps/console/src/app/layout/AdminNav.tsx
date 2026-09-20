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
  | '/admin/projects'
  | '/admin/users'
  | '/admin/authentication'
  | '/admin/compute'
  | '/admin/service-plans'
  | '/admin/task-profiles'
  | '/admin/capabilities'
  | '/admin/requests'
  | '/admin/egress'
  | '/admin/gateway'
  | '/admin/cluster';

interface AdminPageItem {
  readonly to: AdminPagePath;
  readonly labelKey: string;
  readonly exact?: boolean;
}

/** 管理空间按工作分组（RFC-003 §4）：待处理 → 供给与接入 → 平台设置；每页保留独立 URL（RFC-002 §2.1）。 */
const ADMIN_GROUPS: readonly { readonly titleKey?: string; readonly pages: readonly AdminPageItem[] }[] = [
  { pages: [
    { to: '/admin', labelKey: 'nav.admin.overview', exact: true },
    { to: '/admin/requests', labelKey: 'nav.admin.requests' },
  ] },
  { titleKey: 'nav.admin.groupSupply', pages: [
    { to: '/admin/projects', labelKey: 'nav.admin.projects' },
    { to: '/admin/capabilities', labelKey: 'nav.admin.capabilities' },
  ] },
  { titleKey: 'nav.admin.groupSettings', pages: [
    { to: '/admin/users', labelKey: 'nav.admin.users' },
    { to: '/admin/authentication', labelKey: 'nav.admin.authentication' },
    { to: '/admin/compute', labelKey: 'nav.admin.compute' },
    { to: '/admin/service-plans', labelKey: 'nav.admin.servicePlans' },
    { to: '/admin/task-profiles', labelKey: 'nav.admin.taskProfiles' },
    { to: '/admin/egress', labelKey: 'nav.admin.egress' },
    { to: '/admin/cluster', labelKey: 'cluster.title' },
    { to: '/admin/gateway', labelKey: 'nav.admin.gateway' },
  ] },
];

export function AdminNav(): ReactElement {
  const t = useT();
  const { projectId } = useParams({ strict: false }), path = useLocation().pathname;
  const me = useApiQuery(queryKeys.me(), () => api.me.get());
  // 身份确定不是管理员时不再列出管理页：每一页都只会是同一个拒绝说明，左栏只留回工作台。
  const nonAdmin = !me.isPending && !me.error && me.data !== undefined && me.data.platformRole !== 'admin';
  const inProject = path.startsWith('/admin/integrations/') && projectId && !me.error && me.data?.platformRole === 'admin';
  if (inProject) {
    return (
      <nav className={styles.nav} aria-label={t('nav.aria')}>
        <ProjectNavSection projectId={projectId} space="admin" backTo={<Link to="/admin/capabilities" search={{ tab: 'integrations' }} className={styles.back}>← {t('nav.admin.backToIntegrations')}</Link>} />
        <details className={styles.globalTools}><summary>{t('nav.admin.section')}</summary><AdminGlobalLinks /></details>
      </nav>
    );
  }
  return (
    <NavFrame subtitleKey="app.adminSpace" hintKey="nav.adminHint">
      {nonAdmin ? <Link to="/" className={styles.back}>← {t('admin.denied.back')}</Link> : <AdminGlobalLinks />}
    </NavFrame>
  );
}

function AdminGlobalLinks() {
  const t = useT();
  return <>
    {ADMIN_GROUPS.map((group, index) => <div key={group.titleKey ?? index} className={styles.section}>
      {group.titleKey ? <div className={styles.groupTitle}>{t(group.titleKey)}</div> : null}
      <ul className={styles.list}>
        {group.pages.map((item) => <li key={item.to}><Link to={item.to} className={styles.link} activeProps={{ className: styles.linkActive }} activeOptions={{ exact: item.exact ?? false }}>{t(item.labelKey)}</Link></li>)}
      </ul>
    </div>)}
  </>;
}
