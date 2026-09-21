import { Link, Navigate, useParams } from '@tanstack/react-router';
import { api } from '../../../shared/api/client';
import { useAdminPage } from '../../../shared/admin/useAdminRead';
import { useT } from '../../../shared/lib/useT';
import { QueryStatus } from '../../../shared/ui/QueryStatus';
import { Stack } from '../../../shared/ui/Stack';
import { Button } from '../../../shared/ui/Button';
import { ProjectComputeCard } from '../components/projects/ProjectComputeCard';
import { ProjectServiceCard } from '../components/projects/ProjectServiceCard';
import { ProjectQuotaCard } from '../components/projects/ProjectQuotaCard';
import { AdminSection } from './AdminSection';

export function AdminProjectComputePage() {
  const { projectId } = useParams({ strict: false }), t = useT();
  const { query, me, allowed } = useAdminPage(['project-resource-page', projectId], async () => {
    const project = await api.projects.get(projectId!);
    if (project.id !== projectId) throw new Error(t('admin.directory.invalid'));
    return project;
  }, !!projectId);
  return <AdminSection title={query.data ? `${query.data.name} · ${t('admin.resources.title')}` : t('admin.resources.title')} description={t('admin.resources.description')}>
    <Link to="/admin/projects">{t('nav.admin.projects')}</Link>
    <QueryStatus isPending={query.isPending} error={query.error ?? me.error} />
    {query.error ? <Button onClick={() => void query.refetch()}>{t('admin.projectCompute.reload')}</Button> : null}
    {allowed && query.data && !query.error ? <Stack key={`${projectId}:${me.data!.id}`}>
      <ProjectServiceCard projectId={projectId!} viewerId={me.data!.id} />
      <ProjectComputeCard projectId={projectId!} viewerId={me.data!.id} />
      <ProjectQuotaCard projectId={projectId!} viewerId={me.data!.id} />
    </Stack> : null}
  </AdminSection>;
}

export function AdminProjectComputeLegacyPage() {
  const { projectId } = useParams({ strict: false });
  return <Navigate to="/admin/projects/$projectId/resources" params={{ projectId: projectId! }} replace />;
}
