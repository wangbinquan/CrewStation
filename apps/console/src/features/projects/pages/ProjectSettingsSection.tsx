import { useProjectScope } from '../../../shared/project/ProjectScope';
import { useT } from '../../../shared/lib/useT';
import { DefinitionList } from '../../../shared/ui/DefinitionList';
import { Stack } from '../../../shared/ui/Stack';
import { QueryStatus } from '../../../shared/ui/QueryStatus';
import { MembersCard } from '../components/MembersCard';
import { RepositoryCard } from '../components/RepositoryCard';
import { ProjectLifecycleCard } from '../components/ProjectLifecycleCard';
import { useProjectOwnership } from '../model/useProjectOwnership';
import { useProjectService } from '../model/useProjectService';

/** 设置里由 projects feature 提供的三段：成员、项目信息（仓库与技术详情）、归档。 */
export function ProjectSettingsSection({ section }: { readonly section: 'members' | 'info' | 'lifecycle' }) {
  const t = useT(), { projectId } = useProjectScope();
  const ownership = useProjectOwnership(projectId);
  const { project, serviceId, isPending, error } = useProjectService(projectId);
  if (section === 'members') return <MembersCard key={projectId} projectId={projectId} ownership={ownership} />;
  return <>
    <QueryStatus isPending={isPending} error={error} />
    {section === 'info' && project ? <Stack>{serviceId ? <RepositoryCard serviceId={serviceId} /> : null}<details><summary>{t('settings.technicalDetails')}</summary><DefinitionList items={[{ label: 'Project ID', value: <code>{project.id}</code> }, { label: 'Service ID', value: <code>{project.serviceId ?? '—'}</code> }, { label: 'Namespace', value: <code>{project.namespace}</code> }]} /></details></Stack> : null}
    {section === 'info' && !isPending && !error && !serviceId ? <p>{t('projects.overview.noService')}</p> : null}
    {section === 'lifecycle' && project ? <ProjectLifecycleCard key={project.id} project={project} isAdmin={ownership.isAdmin} unavailable={ownership.unavailable || isPending || Boolean(error)} /> : null}
  </>;
}
