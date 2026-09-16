import { Link, useLocation, useParams } from '@tanstack/react-router';
import type { ReactElement } from 'react';
import { useT } from '../../shared/lib/useT';
import { useProjectIdentity } from '../../shared/project/useProjectIdentity';
import { api } from '../../shared/api/client';
import { queryKeys } from '../../shared/api/queryKeys';
import { useApiQuery } from '../../shared/api/useApi';
import { Brand } from '../../shared/ui/Brand';
import { CurrentUserChip } from './CurrentUserChip';
import { LocaleSwitch } from './LocaleSwitch';
import { SpaceSwitch } from './SpaceSwitch';
import { AgentActivityMenu } from './activity/AgentActivityMenu';
import styles from './TopBar.module.css';

/**
 * 顶栏：品牌、工作台全局入口（能力市场／数字人项目）、当前项目名；右侧 Agent 动态、空间切换（仅管理员）、界面语言、当前用户。
 * 全局入口放在顶栏，左栏进入项目后只留项目自己的五个入口（RFC-003 设计附件）。管理空间没有租户全局入口。
 */
export function TopBar(): ReactElement {
  const t = useT();
  const { projectId } = useParams({ strict: false });
  const me = useApiQuery(queryKeys.me(), () => api.me.get());
  const path = useLocation().pathname, inAdmin = path.startsWith('/admin');
  const inProject = path.startsWith('/projects/') || path.startsWith('/admin/integrations/') && !me.error && me.data?.isAdmin === true;
  const project = useProjectIdentity(inProject ? projectId : undefined);
  return (
    <header className={styles.bar}>
      <div className={styles.context}>
        <Link to="/" className={styles.brand}><Brand name={t('app.brand')} /></Link>
        {inAdmin ? <span className={styles.space}>{t('app.adminSpace')}</span> : (
          <nav className={styles.globalNav} aria-label={t('nav.global')}>
            <Link to="/market" className={[styles.pill, (path === '/' || path.startsWith('/market')) && styles.pillActive].filter(Boolean).join(' ')}>{t('nav.market')}</Link>
            <Link to="/projects" className={[styles.pill, path.startsWith('/projects') && styles.pillActive].filter(Boolean).join(' ')}>{t('nav.projects')}</Link>
          </nav>
        )}
        {inProject && projectId !== undefined ? (
          <>
            <span className={styles.separator}>/</span>
            <span className={styles.project}>{project.data?.name ?? t('nav.currentProject')}</span>
          </>
        ) : null}
      </div>
      <div className={styles.right}>
        <AgentActivityMenu />
        {/* 接入项目的旧租户地址会跳到管理空间，不能记录成工作台返回位置。 */}
        <SpaceSwitch rememberLocation={!inProject || project.data?.kind === 'DigitalWorker'} />
        <LocaleSwitch />
        <CurrentUserChip />
      </div>
    </header>
  );
}
