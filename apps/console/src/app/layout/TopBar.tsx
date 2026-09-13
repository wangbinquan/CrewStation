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

/** 顶栏：当前空间与位置、空间切换（仅管理员）、界面语言、当前用户。 */
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
        <span className={styles.space}>{t(inAdmin ? 'app.adminSpace' : 'app.workbench')}</span>
        {inProject && projectId !== undefined ? (
          <>
            <span className={styles.separator}>/</span>
            <span className={styles.project}>{project.data?.name ?? t('nav.currentProject')}</span>
          </>
        ) : null}
      </div>
      <div className={styles.right}>
        <AgentActivityMenu />
        <SpaceSwitch />
        <LocaleSwitch />
        <CurrentUserChip />
      </div>
    </header>
  );
}
