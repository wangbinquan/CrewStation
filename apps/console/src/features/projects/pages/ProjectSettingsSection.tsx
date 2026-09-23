import { useProjectScope } from '../../../shared/project/ProjectScope';
import { useT } from '../../../shared/lib/useT';
import { Stack } from '../../../shared/ui/Stack';
import { QueryStatus } from '../../../shared/ui/QueryStatus';
import { MembersCard } from '../components/MembersCard';
import { ProjectInfoCard } from '../components/ProjectInfoCard';
import { RepositoryCard } from '../components/RepositoryCard';
import { ProjectLifecycleCard } from '../components/ProjectLifecycleCard';
import { useProjectOwnership } from '../model/useProjectOwnership';
import { useProjectService } from '../model/useProjectService';

/** 设置里由 projects feature 提供的三段：成员、项目信息（最上面的项目信息卡与仓库）、归档。 */
export function ProjectSettingsSection({ section }: { readonly section: 'members' | 'info' | 'lifecycle' }) {
  const t = useT(), { projectId } = useProjectScope();
  const ownership = useProjectOwnership(projectId);
  const { project, serviceId, isPending, error } = useProjectService(projectId);
  if (section === 'members') return <MembersCard key={projectId} projectId={projectId} ownership={ownership} />;
  return <>
    <QueryStatus isPending={isPending} error={error} />
    {section === 'info' && project ? <Stack><ProjectInfoCard project={project} />{serviceId ? <RepositoryCard serviceId={serviceId} /> : null}</Stack> : null}
    {section === 'info' && !isPending && !error && !serviceId ? <p>{t('projects.overview.noService')}</p> : null}
    {section === 'lifecycle' && project ? <ProjectLifecycleCard key={project.id} project={project} isAdmin={ownership.isAdmin} unavailable={ownership.unavailable || isPending || Boolean(error)} /> : null}
  </>;
}
