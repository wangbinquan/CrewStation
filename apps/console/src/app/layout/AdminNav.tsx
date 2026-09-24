import { Link, useLocation, useParams } from '@tanstack/react-router';
import type { ReactElement } from 'react';
import { useT } from '../../shared/lib/useT';
import { NavFrame } from './NavFrame';
import { ProjectNavSection } from './ProjectNavSection';
import { api } from '../../shared/api/client';
import { queryKeys } from '../../shared/api/queryKeys';
import { useApiQuery } from '../../shared/api/useApi';
import { ADMIN_ENTRY_GROUPS, ADMIN_PENDING_PAGES, currentAdminPage } from '../../shared/admin/adminNavigation';
import type { AdminNavPage, AdminPagePath } from '../../shared/admin/adminNavigation';
import { useIntegrationPage } from '../../shared/admin/useIntegrationPage';
import styles from './SideNav.module.css';

export function AdminNav(): ReactElement {
  const t = useT();
  const { projectId } = useParams({ strict: false }), path = useLocation().pathname;
  const me = useApiQuery(queryKeys.me(), () => api.me.get()), integrationPage = useIntegrationPage();
  // 身份确定不是管理员时不再列出管理页：每一页都只会是同一个拒绝说明，左栏只留回工作台。
  const nonAdmin = !me.isPending && !me.error && me.data !== undefined && me.data.platformRole !== 'admin';
  const inProject = path.startsWith('/admin/integrations/') && projectId && !me.error && me.data?.platformRole === 'admin';
  if (inProject) {
    return (
      <nav className={styles.nav} aria-label={t('nav.aria')}>
        {/* 管理空间的项目空间只装接入项目，它们归「能力接入」，项目管理里没有它们（2026-09-24 裁定）。 */}
        <ProjectNavSection projectId={projectId} space="admin" backTo={<Link to="/admin/capabilities" search={{ tab: 'integrations' }} className={styles.back}>← {t('nav.admin.backToIntegrations')}</Link>} />
      </nav>
    );
  }
  return (
    <NavFrame subtitleKey="app.adminSpace" hintKey="nav.adminHint">
      {nonAdmin ? <Link to="/" className={styles.back}>← {t('admin.denied.back')}</Link> : <AdminGlobalLinks current={currentAdminPage(path, integrationPage)} />}
    </NavFrame>
  );
}

/** 分组树只在 shared/admin/adminNavigation 定义一次；总览页的入口卡片读的是同一份。 */
function AdminGlobalLinks({ current }: { readonly current: AdminPagePath | undefined }) {
  const t = useT();
  return <>
    <AdminLinkSection pages={ADMIN_PENDING_PAGES} current={current} />
    {ADMIN_ENTRY_GROUPS.map((group) => <AdminLinkSection key={group.id} title={t(group.titleKey)} pages={group.pages} current={current} />)}
  </>;
}

/**
 * 当前项由 currentAdminPage 统一算出，不用路由的前缀匹配：新建接入容器等页面的路径在 /admin/projects 下，却归「能力接入」。
 * 路由只在路径完全相同时自己标 aria-current（此时与算出的当前项一致），其余由这里补上。
 */
function AdminLinkSection({ title, pages, current }: { readonly title?: string; readonly pages: readonly AdminNavPage[]; readonly current: AdminPagePath | undefined }) {
  const t = useT();
  return <div className={styles.section}>
    {title ? <div className={styles.groupTitle}>{title}</div> : null}
    <ul className={styles.list}>
      {pages.map((item) => <li key={item.to}><Link to={item.to} className={item.to === current ? `${styles.link} ${styles.linkActive}` : styles.link}
        aria-current={item.to === current ? 'page' : undefined} activeProps={{}} activeOptions={{ exact: true, includeSearch: false }}>{t(item.labelKey)}</Link></li>)}
    </ul>
  </div>;
}
