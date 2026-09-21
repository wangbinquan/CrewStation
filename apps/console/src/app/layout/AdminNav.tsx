import { Link, useLocation, useParams } from '@tanstack/react-router';
import type { ReactElement } from 'react';
import { useT } from '../../shared/lib/useT';
import { NavFrame } from './NavFrame';
import { ProjectNavSection } from './ProjectNavSection';
import { api } from '../../shared/api/client';
import { queryKeys } from '../../shared/api/queryKeys';
import { useApiQuery } from '../../shared/api/useApi';
import { ADMIN_ENTRY_GROUPS, ADMIN_PENDING_PAGES } from '../../shared/admin/adminNavigation';
import type { AdminNavPage } from '../../shared/admin/adminNavigation';
import styles from './SideNav.module.css';

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

/** 分组树只在 shared/admin/adminNavigation 定义一次；总览页的入口卡片读的是同一份。 */
function AdminGlobalLinks() {
  const t = useT();
  return <>
    <AdminLinkSection pages={ADMIN_PENDING_PAGES} />
    {ADMIN_ENTRY_GROUPS.map((group) => <AdminLinkSection key={group.id} title={t(group.titleKey)} pages={group.pages} />)}
  </>;
}

function AdminLinkSection({ title, pages }: { readonly title?: string; readonly pages: readonly AdminNavPage[] }) {
  const t = useT();
  return <div className={styles.section}>
    {title ? <div className={styles.groupTitle}>{title}</div> : null}
    <ul className={styles.list}>
      {pages.map((item) => <li key={item.to}><Link to={item.to} className={styles.link} activeProps={{ className: styles.linkActive }} activeOptions={{ exact: item.exact ?? false }}>{t(item.labelKey)}</Link></li>)}
    </ul>
  </div>;
}
