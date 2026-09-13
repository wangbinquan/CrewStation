import { Link } from '@tanstack/react-router';
import type { ReactElement } from 'react';
import { useT } from '../../shared/lib/useT';
import { useProjectIdentity } from '../../shared/project/useProjectIdentity';
import styles from './SideNav.module.css';

type ProjectPagePath =
  | '/projects/$projectId'
  | '/projects/$projectId/dev-session'
  | '/projects/$projectId/release'
  | '/projects/$projectId/operations'
  | '/projects/$projectId/settings';

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
  { to: '/projects/$projectId/operations', labelKey: 'nav.operations' },
  { to: '/projects/$projectId/settings', labelKey: 'nav.settings' },
];

export function ProjectNavSection({ projectId }: { readonly projectId: string }): ReactElement {
  const t = useT();
  const identity = useProjectIdentity(projectId);
  return (
    <div className={styles.section}>
      <div className={styles.sectionTitle}>
        <span className={styles.projectName} title={identity.data?.name}>{identity.data?.name ?? t('nav.currentProject')}</span>
        {identity.data?.slug ? <code className={styles.projectId} title={identity.data.slug}>{identity.data.slug}</code> : null}
      </div>
      <ul className={styles.list} aria-label={t('nav.projectPages')}>
        {PROJECT_PAGES.map((item) => (
          <li key={item.to}>
            <Link
              to={item.to}
              params={{ projectId }}
              className={styles.link}
              activeProps={{ className: styles.linkActive }}
              activeOptions={{ exact: item.exact ?? false, includeSearch: false }}
            >
              {t(item.labelKey)}
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}
