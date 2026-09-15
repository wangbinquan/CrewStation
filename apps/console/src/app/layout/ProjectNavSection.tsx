import { Link } from '@tanstack/react-router';
import type { ReactElement } from 'react';
import { useT } from '../../shared/lib/useT';
import { useProjectIdentity } from '../../shared/project/useProjectIdentity';
import { PROJECT_PATHS } from '../../shared/project/projectPaths';
import type { ProjectPage, ProjectSpace } from '../../shared/project/projectPaths';
import styles from './SideNav.module.css';

interface ProjectPageItem {
  readonly page: ProjectPage;
  readonly labelKey: string;
  readonly exact?: boolean;
}

/** 项目内页面入口的顺序即工作台左栏的顺序；路径与各 feature 的 routes.ts 一一对应。 */
const PROJECT_PAGES: readonly ProjectPageItem[] = [
  { page: 'overview', labelKey: 'nav.overview', exact: true },
  { page: 'development', labelKey: 'nav.devSession' },
  { page: 'release', labelKey: 'nav.release' },
  { page: 'operations', labelKey: 'nav.operations' },
  { page: 'settings', labelKey: 'nav.settings' },
];

export function ProjectNavSection({ projectId, space = 'workbench' }: { readonly projectId: string; readonly space?: ProjectSpace }): ReactElement {
  const t = useT();
  const identity = useProjectIdentity(projectId);
  const pages = identity.previewOnly ? [{ page: 'overview' as const, labelKey: 'nav.preview', exact: false }] : PROJECT_PAGES;
  return (
    <div className={styles.section}>
      <div className={styles.sectionTitle}>
        <span className={styles.projectName} title={identity.data?.name}>{identity.data?.name ?? t('nav.currentProject')}</span>
        {identity.data?.slug ? <code className={styles.projectId} title={identity.data.slug}>{identity.data.slug}</code> : null}
      </div>
      <ul className={styles.list} aria-label={t('nav.projectPages')}>
        {pages.map((item) => (
          <li key={item.page}>
            <Link
              to={PROJECT_PATHS[space][item.page]}
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
