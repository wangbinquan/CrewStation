import { useNavigate, useParams, useSearch } from '@tanstack/react-router';
import { ProjectIdSchema } from '@crewstation/contracts';
import { CreateProjectForm, ProjectProvisioningPage } from '../../features/projects';
import { useT } from '../../shared/lib/useT';
import { ActionNote } from '../../shared/ui/ActionNote';
import { PageHeader } from '../../shared/ui/PageHeader';
import { ButtonLink } from '../../shared/ui/navigation/ButtonLink';

export function AdminProjectCreationPage() {
  const t = useT(), navigate = useNavigate(), search = useSearch({ strict: false });
  const scope = search.scope === 'integration' ? 'integration' : 'digital-worker';
  return <>
    <PageHeader title={t(`projects.wizard.title.${scope}`)} description={t('projects.wizard.intro')}
      actions={scope === 'integration' ? <ButtonLink to="/admin/capabilities" search={{ tab: 'integrations' }}>{t('nav.admin.backToIntegrations')}</ButtonLink> : <ButtonLink to="/admin">{t('projects.wizard.backAdmin')}</ButtonLink>} />
    <CreateProjectForm key={scope} scope={scope} onCreated={(project) => { void navigate({ to: '/admin/projects/$projectId/provisioning', params: { projectId: project.id }, replace: true }); }} />
  </>;
}

export function AdminProjectProvisioningPage() {
  const t = useT(), { projectId } = useParams({ strict: false });
  if (!ProjectIdSchema.safeParse(projectId).success) return <ActionNote tone="error">{t('projects.provision.invalidProject')}</ActionNote>;
  return <ProjectProvisioningPage key={projectId} projectId={projectId!} />;
}
