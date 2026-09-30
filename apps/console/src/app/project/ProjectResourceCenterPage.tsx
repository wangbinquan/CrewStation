import { useState } from 'react';
import { useParams } from '@tanstack/react-router';
import { ProjectResourceCenterView } from '../../features/project-resources';
import { ProjectResourcePoliciesDialog } from '../../features/admin';
import { api } from '../../shared/api/client';
import { queryKeys } from '../../shared/api/queryKeys';
import { useApiQuery } from '../../shared/api/useApi';
import { useT } from '../../shared/lib/useT';
import { PageHeader } from '../../shared/ui/PageHeader';
import { Button } from '../../shared/ui/Button';

export function ProjectResourceCenterPage() {
  const { projectId } = useParams({ strict: false }), t = useT(), [policies, setPolicies] = useState(false), me = useApiQuery(queryKeys.me(), () => api.me.get());
  return <><PageHeader title={t('resourceCenter.title')} description={t('resourceCenter.description')} /><ProjectResourceCenterView key={projectId} projectId={projectId!} management={me.data?.isAdmin ? <Button size="small" onClick={() => setPolicies(true)}>{t('resourceCenter.managePolicies')}</Button> : null} />{me.data?.isAdmin ? <ProjectResourcePoliciesDialog key={`policies:${projectId}:${me.data.id}`} open={policies} projectId={projectId!} viewerId={me.data.id} onClose={() => setPolicies(false)} /> : null}</>;
}
