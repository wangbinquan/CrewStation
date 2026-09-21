import { useEffect } from 'react';
import { Link, useLocation, useNavigate, useParams } from '@tanstack/react-router';
import { useT } from '../../shared/lib/useT';
import { api } from '../../shared/api/client';
import { queryKeys } from '../../shared/api/queryKeys';
import { useApiQuery } from '../../shared/api/useApi';
import { useProjectIdentity } from '../../shared/project/useProjectIdentity';
import { Brand } from '../../shared/ui/Brand';
import { CurrentUserChip } from './CurrentUserChip';
import { LocaleSwitch } from './LocaleSwitch';
import { recallWorkbenchPath, rememberWorkbenchPath } from './spaceMemory';
import styles from './TopBar.module.css';

/** Space navigation follows the current platform role; the brand always opens applications. */
export function TopBar() {
  const t = useT(), { pathname: path, href } = useLocation(), navigate = useNavigate();
  const { projectId: currentProjectId } = useParams({ strict: false });
  const adminTarget = currentProjectId && (path.startsWith('/projects/') || path.startsWith('/admin/')) ? '/admin/projects' : '/admin';
  const me = useApiQuery(queryKeys.me(), () => api.me.get());
  const role = !me.error && !me.isPending ? me.data?.platformRole : undefined;
  const projectId = /^\/projects\/([0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})(?:\/|$)/.exec(path)?.[1];
  const canRemember = role === 'admin' || role === 'developer';
  const previewOnly = role !== 'admin' && me.data?.memberships?.some((member) => member.projectId === projectId && member.role === 'tester');
  const project = useProjectIdentity(canRemember && !previewOnly ? projectId : undefined);
  useEffect(() => {
    if (canRemember && path.startsWith('/projects') && (!projectId || !project.error && project.data?.kind === 'DigitalWorker')) rememberWorkbenchPath(href);
  }, [canRemember, path, href, projectId, project.error, project.data?.kind]);
  const development = async () => {
    const identity = await me.refetch();
    const saved = recallWorkbenchPath(), id = /^\/projects\/([0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})(?:[/?]|$)/.exec(saved)?.[1];
    const eligible = identity.data?.platformRole === 'admin' || identity.data?.platformRole === 'developer';
    const allowed = identity.data?.platformRole === 'admin' || !id || identity.data?.memberships?.some((m) => m.projectId === id && m.role !== 'tester');
    if (!identity.error && eligible) void navigate({ href: allowed && saved.startsWith('/projects') ? saved : '/projects' });
  };
  const pill = (active: boolean) => [styles.pill, active && styles.pillActive].filter(Boolean).join(' ');
  return <header className={styles.bar}>
    <div className={styles.context}>
      <Link to="/" className={styles.brand}><Brand name={t('app.brand')} /></Link>
      <nav className={styles.globalNav} aria-label={t('nav.global')}>
        <Link to="/market" className={pill(path === '/' || path.startsWith('/market'))}>{t('nav.market')}</Link>
        {role === 'developer' || role === 'admin' ? <Link to="/projects" onClick={(event) => { event.preventDefault(); void development(); }} className={pill(path.startsWith('/projects'))}>{t('nav.projects')}</Link> : null}
        {role === 'admin' ? <Link to={adminTarget} className={pill(path.startsWith('/admin'))}>{t('app.adminSpace')}</Link> : null}
      </nav>
    </div>
    <div className={styles.right}><LocaleSwitch /><CurrentUserChip /></div>
  </header>;
}
