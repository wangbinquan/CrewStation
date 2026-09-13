import { useNavigate, useSearch } from '@tanstack/react-router';
import { CapabilitiesPage } from '../../features/capabilities';
import { CatalogPage } from '../../features/catalog';
import { ConfigPage } from '../../features/config';
import { EventResources } from '../../features/events';
import { AppVisibilityPage, ProjectSettingsSection } from '../../features/projects';
import { useT } from '../../shared/lib/useT';
import { useProjectScope } from '../../shared/project/ProjectScope';
import { parseSettingsSearch, RESOURCE_TABS, SETTINGS_TABS } from '../../shared/project/settingsSearch';
import type { SettingsSearch, SettingsTab } from '../../shared/project/settingsSearch';
import { PageHeader } from '../../shared/ui/PageHeader';
import { Tabs } from '../../shared/ui/Tabs';
import styles from './ProjectSections.module.css';

/** app 只装配 feature 的公开入口；成员、配置、API 等仍由原 feature 负责。 */
export function ProjectSettingsPage() {
  const t = useT(), { projectId } = useProjectScope(), navigate = useNavigate();
  const search = parseSettingsSearch(useSearch({ strict: false }));
  const tab = search.tab ?? 'members';
  const change = (next: SettingsSearch) => { void navigate({ to: '/projects/$projectId/settings', params: { projectId }, search: next }); };
  return <div className={styles.page}>
    <PageHeader title={t('nav.settings')} />
    <Tabs label={t('nav.settings')} value={tab} items={SETTINGS_TABS.map((value) => ({ value, label: t(`settings.tab.${value}`) }))} onChange={(value) => change({ tab: value as SettingsTab })}>
      {tab === 'visibility' ? <AppVisibilityPage key={projectId} embedded /> : null}
      {tab === 'config' ? <ConfigPage key={projectId} env={search.env ?? 'development'} onEnvironmentChange={(env) => change({ tab, env })} /> : null}
      {tab === 'resources' ? <ProjectResources key={projectId} search={search} change={change} /> : null}
      {tab === 'members' || tab === 'repository' || tab === 'lifecycle' ? <ProjectSettingsSection key={`${projectId}:${tab}`} section={tab} /> : null}
    </Tabs>
  </div>;
}

function ProjectResources({ search, change }: { readonly search: SettingsSearch; readonly change: (next: SettingsSearch) => void }) {
  const t = useT(), resource = search.resource ?? 'overview', { projectId } = useProjectScope();
  return <Tabs label={t('settings.tab.resources')} value={resource} items={RESOURCE_TABS.map((value) => ({ value, label: t(`settings.resource.${value}`) }))} onChange={(value) => change({ tab: 'resources', resource: RESOURCE_TABS.find((item) => item === value) })}>
    {resource === 'overview' ? <CapabilitiesPage embedded /> : null}
    {resource === 'api' ? <CatalogPage embedded proxy={search.proxy} operation={search.operation} onClearContext={() => change({ tab: 'resources', resource: 'api' })} /> : null}
    {resource === 'events' ? <EventResources projectId={projectId} subscription={search.subscription} /> : null}
  </Tabs>;
}
