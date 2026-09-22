import { Link, useNavigate, useSearch } from '@tanstack/react-router';
import { CapabilitiesPage } from '../../features/capabilities';
import { CatalogPage } from '../../features/catalog';
import { EventResources } from '../../features/events';
import { useT } from '../../shared/lib/useT';
import { PROJECT_PATHS } from '../../shared/project/projectPaths';
import { useProjectScope } from '../../shared/project/ProjectScope';
import { parseResourceSearch } from '../../shared/project/resourceSearch';
import type { ResourceSearch, ResourceSection } from '../../shared/project/resourceSearch';
import { PageHeader } from '../../shared/ui/PageHeader';
import { Stack } from '../../shared/ui/Stack';
import { ActionRow } from '../../shared/ui/ActionRow';
import { SectionNavigation } from '../../shared/ui/navigation/SectionNavigation';
import styles from './ProjectSections.module.css';

/** 参考面板落地前仍由本页渲染的三个主题；「数据与存储」「项目与仓库」已由路由重定向到新家（RFC-020 D2）。 */
const SECTIONS = ['api', 'events', 'guide'] as const;

export function ProjectResourcesPage() {
  const t = useT(), { projectId, space } = useProjectScope(), navigate = useNavigate();
  const search = parseResourceSearch(useSearch({ strict: false })), section = SECTIONS.find((value) => value === search.section) ?? 'api';
  const change = (next: ResourceSearch) => { void navigate({ to: PROJECT_PATHS[space].resources, params: { projectId }, search: next }); };
  return <div className={styles.page}>
    <PageHeader title={t('nav.resources')} description={t('resources.description')} />
    <SectionNavigation label={t('resources.groups')} value={section} items={SECTIONS.map((value) => ({ value, label: t(`resources.section.${value}`), description: t(`resources.hint.${value}`) }))} onChange={(value) => change({ section: value as ResourceSection })}>
      <Stack key={`${projectId}:${section}`}>
        <div><h2 className={styles.heading}>{t(`resources.section.${section}`)}</h2><p className={styles.note}>{t(`resources.note.${section}`)}</p></div>
        {section === 'api' ? <CatalogPage embedded proxy={search.proxy} operation={search.operation} onClearContext={() => change({ section: 'api' })} /> : null}
        {section === 'events' ? <><ActionRow>
          <Link to={PROJECT_PATHS[space].development} params={{ projectId }} search={{ view: 'code', file: 'crewstation.yaml' }}>{t('resources.openManifest')}</Link>
          <Link to={PROJECT_PATHS[space].operations} params={{ projectId }} search={{ tab: 'deliveries', subscription: search.subscription }}>{t('resources.openDeliveries')}</Link>
        </ActionRow><EventResources projectId={projectId} subscription={search.subscription} /></> : null}
        {section === 'guide' ? <Link to={PROJECT_PATHS[space].settings} params={{ projectId }} search={{ tab: 'config', env: 'development' }}>{t('resources.openConfig')}</Link> : null}
        {section === 'guide' ? <CapabilitiesPage embedded section={section} topic={search.topic} /> : <details><summary>{t('resources.technicalSummary')}</summary><CapabilitiesPage embedded section={section} /></details>}
      </Stack>
    </SectionNavigation>
  </div>;
}
