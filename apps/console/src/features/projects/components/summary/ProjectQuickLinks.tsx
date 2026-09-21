import { Link } from '@tanstack/react-router';
import { useT } from '../../../../shared/lib/useT';
import { useProjectScope } from '../../../../shared/project/ProjectScope';
import { PROJECT_PATHS } from '../../../../shared/project/projectPaths';
import { Card } from '../../../../shared/ui/Card';
import styles from './ProjectQuickLinks.module.css';

const entries = [
  { id: 'release', page: 'release', label: 'projects.overview.goRelease', search: {} },
  { id: 'members', page: 'settings', label: 'settings.tab.members', search: { tab: 'members' } },
  { id: 'repository', page: 'resources', label: 'settings.tab.repository', search: { section: 'project' } },
  { id: 'resources', page: 'resources', label: 'settings.tab.resources', search: { section: 'api' } },
] as const;

/** 概览的次级入口集中呈现，保持当前项目与空间；整项是原生导航链接。 */
export function ProjectQuickLinks() {
  const t = useT(), { projectId, space } = useProjectScope();
  const title = t('projects.overview.quickLinks');
  return <Card compact title={title} className={styles.card}>
    <nav aria-label={title} className={styles.links}>
      {entries.map((entry) => <Link key={entry.id} to={PROJECT_PATHS[space][entry.page]} params={{ projectId }} search={entry.search} className={styles.link}>
        <span className={styles.copy}><strong>{t(entry.label)}</strong><small>{t(`projects.overview.quickLinks.${entry.id}`)}</small></span>
        <span className={styles.arrow} aria-hidden="true">→</span>
      </Link>)}
    </nav>
  </Card>;
}
