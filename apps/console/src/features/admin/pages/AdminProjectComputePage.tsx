import { Link, useParams } from '@tanstack/react-router';
import { useState } from 'react';
import { ProjectComputePolicyDtoSchema } from '@crewstation/contracts';
import { api } from '../../../shared/api/client';
import { useAdminPage } from '../../../shared/admin/useAdminRead';
import { useT } from '../../../shared/lib/useT';
import { QueryStatus } from '../../../shared/ui/QueryStatus';
import { Button } from '../../../shared/ui/Button';
import { ProjectComputeForm } from '../components/projects/ProjectComputeForm';
import { AdminSection } from './AdminSection';

export function AdminProjectComputePage() {
  const { projectId } = useParams({ strict: false }), t = useT(), [generation, setGeneration] = useState(0);
  const { query, me, allowed } = useAdminPage(['project-compute-editor', projectId, generation], async () => {
    const [project, raw, profiles, tasks] = await Promise.all([api.projects.get(projectId!), api.projects.getComputePolicy(projectId!), api.computeProfiles.list(), api.catalog.listTaskProfiles()]);
    const policy = ProjectComputePolicyDtoSchema.parse(raw);
    if (policy.projectId !== projectId || project.id !== projectId) throw new Error(t('admin.directory.invalid'));
    return { project, policy, profiles: profiles.items, tasks: tasks.items };
  }, !!projectId);
  return <AdminSection title={query.data?.project.name ?? t('admin.projectCompute.title')} description={t('admin.projectCompute.description')}>
    <Link to="/admin/projects">{t('nav.admin.projects')}</Link>
    <QueryStatus isPending={query.isPending} error={query.error ?? me.error} />
    {query.error ? <Button onClick={() => void query.refetch()}>{t('admin.projectCompute.reload')}</Button> : null}
    {allowed && query.data && !query.error ? <ProjectComputeForm key={`${projectId}:${generation}`} initial={query.data.policy} profiles={query.data.profiles} tasks={query.data.tasks} viewerId={me.data!.id} onReload={() => setGeneration((value) => value + 1)} /> : null}
  </AdminSection>;
}
