import { useProjectScope } from '../../../shared/project/ProjectScope';
import { useT } from '../../../shared/lib/useT';
import { QueryStatus } from '../../../shared/ui/QueryStatus';
import { MembersCard } from '../components/MembersCard';
import { RepositoryCard } from '../components/RepositoryCard';
import { ProjectLifecycleCard } from '../components/ProjectLifecycleCard';
import { useProjectOwnership } from '../model/useProjectOwnership';
import { useProjectService } from '../model/useProjectService';

export function ProjectSettingsSection({ section }: { readonly section: 'members' | 'repository' | 'lifecycle' }) {
  const t = useT(), { projectId } = useProjectScope();
  const ownership = useProjectOwnership(projectId);
  const { project, serviceId, isPending, error } = useProjectService(projectId);
  if (section === 'members') return <MembersCard key={projectId} projectId={projectId} ownership={ownership} />;
  return <>
    <QueryStatus isPending={isPending} error={error} />
    {section === 'repository' && serviceId ? <RepositoryCard serviceId={serviceId} /> : null}
    {section === 'repository' && !isPending && !error && !serviceId ? <p>{t('projects.overview.noService')}</p> : null}
    {section === 'lifecycle' && project ? <ProjectLifecycleCard key={project.id} project={project} isAdmin={ownership.isAdmin} unavailable={ownership.unavailable || isPending || Boolean(error)} /> : null}
  </>;
}
