import { useState } from 'react';
import { ProjectServicePolicyDtoSchema, ServicePlanDtoSchema } from '@crewstation/contracts';
import { api } from '../../../../shared/api/client';
import { useAdminPage } from '../../../../shared/admin/useAdminRead';
import { useT } from '../../../../shared/lib/useT';
import { Card } from '../../../../shared/ui/Card';
import { QueryStatus } from '../../../../shared/ui/QueryStatus';
import { ProjectServiceForm } from './ProjectServiceForm';

export function ProjectServiceCard({ projectId, viewerId }: { readonly projectId: string; readonly viewerId: string }) {
  const t = useT(), [generation, setGeneration] = useState(0);
  const { query } = useAdminPage(['project-service-editor', projectId, generation], async () => {
    const [raw, plans] = await Promise.all([api.projects.getServicePolicy(projectId), api.catalog.listServicePlans()]);
    const policy = ProjectServicePolicyDtoSchema.parse(raw);
    if (policy.projectId !== projectId) throw new Error(t('admin.directory.invalid'));
    return { policy, plans: ServicePlanDtoSchema.array().parse(plans.items) };
  });
  return <Card stacked title={t('admin.resources.service')} footer={t('admin.resources.serviceEffect')}>
    <QueryStatus isPending={query.isPending} error={query.error} />
    {query.data && !query.error ? <ProjectServiceForm key={generation} initial={query.data.policy} plans={query.data.plans} viewerId={viewerId} onReload={() => setGeneration((value) => value + 1)} /> : null}
  </Card>;
}
