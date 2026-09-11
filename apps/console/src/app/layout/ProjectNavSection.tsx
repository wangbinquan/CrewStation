import { Link } from '@tanstack/react-router';
import type { ReactElement } from 'react';
import { useT } from '../../shared/lib/useT';
import styles from './SideNav.module.css';

type ProjectPagePath =
  | '/projects/$projectId'
  | '/projects/$projectId/dev-session'
  | '/projects/$projectId/release'
  | '/projects/$projectId/config'
  | '/projects/$projectId/catalog'
  | '/projects/$projectId/events'
  | '/projects/$projectId/logs'
  | '/projects/$projectId/capabilities';

interface ProjectPageItem {
  readonly to: ProjectPagePath;
  readonly labelKey: string;
  readonly exact?: boolean;
}

/** 项目内页面入口的顺序即工作台左栏的顺序；路径与各 feature 的 routes.ts 一一对应。 */
const PROJECT_PAGES: readonly ProjectPageItem[] = [
  { to: '/projects/$projectId', labelKey: 'nav.overview', exact: true },
  { to: '/projects/$projectId/dev-session', labelKey: 'nav.devSession' },
  { to: '/projects/$projectId/release', labelKey: 'nav.release' },
  { to: '/projects/$projectId/config', labelKey: 'nav.config' },
  { to: '/projects/$projectId/catalog', labelKey: 'nav.catalog' },
  { to: '/projects/$projectId/events', labelKey: 'nav.events' },
  { to: '/projects/$projectId/logs', labelKey: 'nav.logs' },
  { to: '/projects/$projectId/capabilities', labelKey: 'nav.capabilities' },
];

export function ProjectNavSection({ projectId }: { readonly projectId: string }): ReactElement {
  const t = useT();
  return (
    <div className={styles.section}>
      <div className={styles.sectionTitle}>
        {t('nav.currentProject')}
        <code className={styles.projectId}>{projectId}</code>
      </div>
      <ul className={styles.list}>
        {PROJECT_PAGES.map((item) => (
          <li key={item.to}>
            <Link
              to={item.to}
              params={{ projectId }}
              className={styles.link}
              activeProps={{ className: styles.linkActive }}
              activeOptions={{ exact: item.exact ?? false }}
            >
              {t(item.labelKey)}
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}
