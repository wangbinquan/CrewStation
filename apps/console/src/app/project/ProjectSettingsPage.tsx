import { useNavigate, useSearch } from '@tanstack/react-router';
import { ConfigPage } from '../../features/config';
import { AppVisibilityPage, ProjectSettingsSection } from '../../features/projects';
import { useT } from '../../shared/lib/useT';
import { PROJECT_PATHS } from '../../shared/project/projectPaths';
import { useProjectScope } from '../../shared/project/ProjectScope';
import { parseSettingsSearch, SETTINGS_TABS } from '../../shared/project/settingsSearch';
import type { SettingsSearch, SettingsTab } from '../../shared/project/settingsSearch';
import { PageHeader } from '../../shared/ui/PageHeader';
import { SectionNavigation } from '../../shared/ui/navigation/SectionNavigation';
import styles from './ProjectSections.module.css';

/** app 只装配 feature 的公开入口；设置只呈现当前可以维护的内容。 */
export function ProjectSettingsPage() {
  const t = useT(), { projectId, space } = useProjectScope(), navigate = useNavigate();
  const search = parseSettingsSearch(useSearch({ strict: false }));
  const tabs = SETTINGS_TABS.filter((tab) => space !== 'admin' || tab !== 'visibility');
  const tab = tabs.find((value) => value === search.tab) ?? 'config';
  const change = (next: SettingsSearch) => { void navigate({ to: PROJECT_PATHS[space].settings, params: { projectId }, search: next }); };
  return <div className={styles.page}>
    <PageHeader title={t('nav.settings')} description={t('settings.description')} />
    <SectionNavigation label={t('settings.groups')} value={tab} items={tabs.map((value) => ({ value, label: t(`settings.tab.${value}`), description: t(`settings.hint.${value}`) }))} onChange={(value) => change({ tab: value as SettingsTab })}>
      {tab === 'visibility' ? <AppVisibilityPage key={projectId} embedded /> : null}
      {tab === 'config' ? <ConfigPage key={projectId} env={search.env ?? 'development'} onEnvironmentChange={(env) => change({ tab, env })} /> : null}
      {tab === 'members' || tab === 'advanced' ? <ProjectSettingsSection key={`${projectId}:${tab}`} section={tab === 'advanced' ? 'lifecycle' : 'members'} /> : null}
    </SectionNavigation>
  </div>;
}
