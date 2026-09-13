import { useProjectScope } from '../../../shared/project/ProjectScope';
import { useT } from '../../../shared/lib/useT';
import { Card } from '../../../shared/ui/Card';
import { DefinitionList } from '../../../shared/ui/DefinitionList';
import { QueryStatus } from '../../../shared/ui/QueryStatus';
import { MembersCard } from '../components/MembersCard';
import { RepositoryCard } from '../components/RepositoryCard';
import { ProjectStateBadge } from '../components/ProjectStateBadge';
import { useProjectOwnership } from '../model/useProjectOwnership';
import { useProjectService } from '../model/useProjectService';

export function ProjectSettingsSection({ section }: { readonly section: 'members' | 'repository' | 'lifecycle' }) {
  const t = useT(), { projectId } = useProjectScope();
  const { isOwner, isAdmin } = useProjectOwnership(projectId);
  const { project, serviceId, isPending, error } = useProjectService(projectId);
  if (section === 'members') return <MembersCard projectId={projectId} canManage={isOwner} isAdmin={isAdmin} />;
  return <>
    <QueryStatus isPending={isPending} error={error} />
    {section === 'repository' && serviceId ? <RepositoryCard serviceId={serviceId} /> : null}
    {section === 'repository' && !isPending && !error && !serviceId ? <p>{t('projects.overview.noService')}</p> : null}
    {section === 'lifecycle' && project ? <Card compact title={t('settings.tab.lifecycle')}>
      <p><ProjectStateBadge state={project.state} /> {project.message}</p>
      <details><summary>{t('settings.technicalDetails')}</summary><DefinitionList items={[
        { label: 'Project ID', value: <code>{project.id}</code> },
        { label: 'Service ID', value: <code>{project.serviceId ?? '—'}</code> },
        { label: 'Namespace', value: <code>{project.namespace}</code> },
      ]} /></details>
    </Card> : null}
  </>;
}
