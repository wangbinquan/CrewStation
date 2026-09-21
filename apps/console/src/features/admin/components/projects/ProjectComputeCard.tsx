import { useState } from 'react';
import { ProjectComputePolicyDtoSchema } from '@crewstation/contracts';
import { api } from '../../../../shared/api/client';
import { useAdminPage } from '../../../../shared/admin/useAdminRead';
import { useT } from '../../../../shared/lib/useT';
import { QueryStatus } from '../../../../shared/ui/QueryStatus';
import { Button } from '../../../../shared/ui/Button';
import { ProjectComputeForm } from './ProjectComputeForm';

export function ProjectComputeCard({ projectId, viewerId }: { readonly projectId: string; readonly viewerId: string }) {
  const t = useT(), [generation, setGeneration] = useState(0);
  const { query } = useAdminPage(['project-compute-editor', projectId, generation], async () => {
    const [raw, profiles, tasks] = await Promise.all([api.projects.getComputePolicy(projectId), api.computeProfiles.list(), api.catalog.listTaskProfiles()]);
    const policy = ProjectComputePolicyDtoSchema.parse(raw);
    if (policy.projectId !== projectId) throw new Error(t('admin.directory.invalid'));
    return { policy, profiles: profiles.items, tasks: tasks.items };
  });
  return <section aria-label={t('admin.resources.compute')}>
    <QueryStatus isPending={query.isPending} error={query.error} />
    {query.error ? <Button onClick={() => void query.refetch()}>{t('admin.projectCompute.reload')}</Button> : null}
    {query.data && !query.error ? <ProjectComputeForm key={generation} initial={query.data.policy} profiles={query.data.profiles} tasks={query.data.tasks} viewerId={viewerId} onReload={() => setGeneration((value) => value + 1)} /> : null}
  </section>;
}
